import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { mapErrorToResponse, withApi } from "@/lib/api";
import { answerQuestion, streamAnswer } from "@/lib/providers";
import { enforceRateLimit } from "@/lib/ratelimit";
import { search } from "@/lib/search";
import { readMode, sanitiseChunkForPrompt } from "@/lib/rag/sanitise";

export const askSchema = z.object({
  question: z.string().min(3).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  stream: z.boolean().optional(),
});

export const runtime = "nodejs";

interface PromptContext {
  id: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  /** Original (post-zero-width-strip) chunk text — shown in Sources. */
  text: string;
  /** Sanitised text passed to the LLM. Empty if the chunk was blocked. */
  promptText: string;
  score: number;
  flags: string[];
  blocked: boolean;
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamRequested =
    url.searchParams.get("stream") === "1" ||
    (req.headers.get("accept") ?? "").includes("text/event-stream");

  return streamRequested ? streamHandler(req) : jsonHandler(req);
}

async function jsonHandler(req: Request) {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
    await enforceRateLimit("ask", user.id);
    const body = askSchema.parse(await req.json());
    const contexts = await retrieveAndSanitise(workspace.id, body.question, body.topK ?? 6);

    const llm = await answerQuestion({
      question: body.question,
      contexts: toLlmContexts(contexts),
    });
    return persistAndShape({
      workspaceId: workspace.id,
      userId: user.id,
      question: body.question,
      answer: llm.answer,
      provider: llm.provider,
      model: llm.model,
      contexts,
    });
  });
}

/** SSE handler. Emits:
 *    event: ctx      data: { contexts: [...], injectionMode }   (once, before first delta)
 *    event: delta    data: { text }
 *    event: done     data: { id, answer, provider, model, citations, contexts }
 *    event: error    data: { error }
 */
async function streamHandler(req: Request): Promise<Response> {
  let setup: Awaited<ReturnType<typeof prepareStream>>;
  try {
    setup = await prepareStream(req);
  } catch (err) {
    // Reuse the same error → response mapping used by `withApi` so SSE setup
    // errors carry identical headers and statuses to the JSON handler.
    return mapErrorToResponse(err);
  }

  const { workspace, user, body, contexts } = setup;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        sse("ctx", {
          injectionMode: readMode(),
          contexts: contexts.map((c) => ({
            chunkId: c.id,
            documentId: c.documentId,
            filename: c.filename,
            chunkIndex: c.chunkIndex,
            score: c.score,
            text: c.text,
            flags: c.flags,
            blocked: c.blocked,
          })),
        });

        let accumulated = "";
        let finalProvider: string | null = null;
        let finalModel: string | null = null;
        let sawDone = false;

        for await (const evt of streamAnswer({
          question: body.question,
          contexts: toLlmContexts(contexts),
        })) {
          if (evt.type === "delta") {
            accumulated += evt.text;
            sse("delta", { text: evt.text });
          } else if (evt.type === "done") {
            sawDone = true;
            finalProvider = evt.result.provider;
            finalModel = evt.result.model;
            if (evt.result.answer) accumulated = evt.result.answer;
          }
        }

        if (!sawDone) {
          // The provider chain exhausted without emitting `done` — typically a
          // provider that throws *and* has no successor. The mock provider is
          // always the final link in the chain, so this should never happen in
          // practice; treat as an error rather than persisting a stub answer.
          throw new Error("LLM provider chain produced no response");
        }

        const shaped = await persistAndShape({
          workspaceId: workspace.id,
          userId: user.id,
          question: body.question,
          answer: accumulated,
          provider: finalProvider ?? "unknown",
          model: finalModel ?? "unknown",
          contexts,
        });
        sse("done", shaped);
      } catch (err) {
        console.error("[ask:stream] failed", err);
        sse("error", { error: err instanceof Error ? err.message : "stream failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function prepareStream(req: Request) {
  const { workspace, user } = await requireCurrentWorkspace();
  await enforceRateLimit("ask", user.id);
  const body = askSchema.parse(await req.json());
  const contexts = await retrieveAndSanitise(workspace.id, body.question, body.topK ?? 6);
  return { workspace, user, body, contexts };
}

async function retrieveAndSanitise(
  workspaceId: string,
  question: string,
  topK: number,
): Promise<PromptContext[]> {
  const mode = readMode();
  const retrieval = await search(workspaceId, question, "hybrid", {}, topK);
  return retrieval.hits.map((h) => {
    const s = sanitiseChunkForPrompt(h.text, mode);
    return {
      id: h.chunkId,
      documentId: h.documentId,
      filename: h.filename,
      chunkIndex: h.chunkIndex,
      // Show the cleaned (zero-width stripped) text to the user in Sources, but
      // unmodified by `strip` redactions — those are an LLM-only protection.
      text: s.text === "" && s.blocked ? h.text : s.text,
      promptText: s.text,
      score: h.score,
      flags: s.flags,
      blocked: s.blocked,
    };
  });
}

function toLlmContexts(contexts: PromptContext[]) {
  return contexts
    .filter((c) => !c.blocked)
    .map((c) => ({
      id: c.id,
      documentId: c.documentId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      text: c.promptText,
      score: c.score,
      flags: c.flags,
    }));
}

interface PersistArgs {
  workspaceId: string;
  userId: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  contexts: PromptContext[];
}

async function persistAndShape(p: PersistArgs) {
  const retrievalScore = p.contexts.length ? p.contexts[0].score : null;
  const citations = p.contexts.map((c, i) => ({
    n: i + 1,
    chunkId: c.id,
    documentId: c.documentId,
    filename: c.filename,
    chunkIndex: c.chunkIndex,
    score: c.score,
    flags: c.flags,
    blocked: c.blocked,
  }));
  const stored = await prisma.question.create({
    data: {
      workspaceId: p.workspaceId,
      userId: p.userId,
      question: p.question,
      answer: p.answer,
      citations,
      model: p.model,
      provider: p.provider,
      retrievalScore: retrievalScore ?? undefined,
    },
  });
  return {
    id: stored.id,
    answer: p.answer,
    provider: p.provider,
    model: p.model,
    citations,
    contexts: p.contexts.map((c) => ({
      chunkId: c.id,
      documentId: c.documentId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      score: c.score,
      text: c.text,
      flags: c.flags,
      blocked: c.blocked,
    })),
  };
}
