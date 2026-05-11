import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, RateLimitError, withApi } from "@/lib/api";
import { UnauthorizedError, ForbiddenError } from "@/lib/auth/server";
import { ZodError } from "zod";
import { answerQuestion, streamAnswer } from "@/lib/providers";
import { enforceRateLimit, rateLimitHeaders } from "@/lib/ratelimit";
import { search } from "@/lib/search";

export const askSchema = z.object({
  question: z.string().min(3).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
  stream: z.boolean().optional(),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamRequested =
    url.searchParams.get("stream") === "1" ||
    (req.headers.get("accept") ?? "").includes("text/event-stream");

  if (!streamRequested) return jsonHandler(req);
  return streamHandler(req);
}

async function jsonHandler(req: Request) {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
    await enforceRateLimit("ask", user.id);
    const body = askSchema.parse(await req.json());
    const topK = body.topK ?? 6;

    const retrieval = await search(workspace.id, body.question, "hybrid", {}, topK);
    const contexts = retrieval.hits.map((h) => ({
      id: h.chunkId,
      documentId: h.documentId,
      filename: h.filename,
      chunkIndex: h.chunkIndex,
      text: h.text,
      score: h.score,
    }));

    const llm = await answerQuestion({ question: body.question, contexts });
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
 *    event: delta    data: {"text": "..."}
 *    event: ctx      data: {"contexts": [...]}             (once, before first delta)
 *    event: done     data: { id, answer, provider, model, citations, contexts }
 *    event: error    data: { error: "..." }
 */
async function streamHandler(req: Request): Promise<Response> {
  // Run sync setup (auth, rate limit, retrieval) up-front so failures still surface
  // as plain HTTP errors instead of half-open SSE streams.
  let setup: Awaited<ReturnType<typeof prepareStream>>;
  try {
    setup = await prepareStream(req);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 429,
        headers: { "content-type": "application/json", ...rateLimitHeaders(err.rate) },
      });
    }
    if (err instanceof UnauthorizedError) return errResp(401, err.message);
    if (err instanceof ForbiddenError) return errResp(403, err.message);
    if (err instanceof ZodError) return errResp(400, "Invalid request");
    if (err instanceof ApiError) return errResp(err.status, err.message);
    console.error("[ask:stream] setup failed", err);
    return errResp(500, "Internal error");
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
          contexts: contexts.map((c) => ({
            chunkId: c.id,
            documentId: c.documentId,
            filename: c.filename,
            chunkIndex: c.chunkIndex,
            score: c.score,
            text: c.text,
          })),
        });

        let accumulated = "";
        let provider = "mock";
        let model = "mock-rag";

        for await (const evt of streamAnswer({ question: body.question, contexts })) {
          if (evt.type === "delta") {
            accumulated += evt.text;
            sse("delta", { text: evt.text });
          } else if (evt.type === "done") {
            provider = evt.result.provider;
            model = evt.result.model;
            // Use the canonical answer from the provider (some collapse leading whitespace).
            accumulated = evt.result.answer || accumulated;
          }
        }

        const shaped = await persistAndShape({
          workspaceId: workspace.id,
          userId: user.id,
          question: body.question,
          answer: accumulated,
          provider,
          model,
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
  const topK = body.topK ?? 6;
  const retrieval = await search(workspace.id, body.question, "hybrid", {}, topK);
  const contexts = retrieval.hits.map((h) => ({
    id: h.chunkId,
    documentId: h.documentId,
    filename: h.filename,
    chunkIndex: h.chunkIndex,
    text: h.text,
    score: h.score,
  }));
  return { workspace, user, body, contexts };
}

interface PersistArgs {
  workspaceId: string;
  userId: string;
  question: string;
  answer: string;
  provider: string;
  model: string;
  contexts: Array<{
    id: string;
    documentId: string;
    filename: string;
    chunkIndex: number;
    text: string;
    score: number;
  }>;
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
    })),
  };
}

function errResp(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
