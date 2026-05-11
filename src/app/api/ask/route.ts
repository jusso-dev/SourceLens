import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { answerQuestion } from "@/lib/providers";
import { search } from "@/lib/search";

export const askSchema = z.object({
  question: z.string().min(3).max(2000),
  topK: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
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

    const retrievalScore = contexts.length ? contexts[0].score : null;

    const citations = contexts.map((c, i) => ({
      n: i + 1,
      chunkId: c.id,
      documentId: c.documentId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      score: c.score,
    }));

    const stored = await prisma.question.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        question: body.question,
        answer: llm.answer,
        citations,
        model: llm.model,
        provider: llm.provider,
        retrievalScore: retrievalScore ?? undefined,
      },
    });

    return {
      id: stored.id,
      answer: llm.answer,
      provider: llm.provider,
      model: llm.model,
      citations,
      contexts: contexts.map((c) => ({
        chunkId: c.id,
        documentId: c.documentId,
        filename: c.filename,
        chunkIndex: c.chunkIndex,
        score: c.score,
        text: c.text,
      })),
    };
  });
}
