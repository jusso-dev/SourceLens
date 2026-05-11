import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import type { ChatProvider, EmbeddingProvider } from "./types";

/** Deterministic mock embeddings.
 *  Hash the text, expand the digest into `dim` floats in [-1, 1], L2-normalise.
 *  Same text always produces the same vector — enough for demos and tests. */
export const mockEmbeddings: EmbeddingProvider = {
  name: "mock",
  dim: env.embeddingDim,
  async embed(texts) {
    return texts.map((t) => deterministicVector(t, env.embeddingDim));
  },
};

function deterministicVector(text: string, dim: number): number[] {
  const out: number[] = new Array(dim);
  let counter = 0;
  let buf = Buffer.alloc(0);
  while (buf.length < dim * 2) {
    const h = createHash("sha256");
    h.update(text);
    h.update(String(counter++));
    buf = Buffer.concat([buf, h.digest()]);
  }
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    const u = buf.readUInt16BE(i * 2) / 0xffff; // 0..1
    const v = u * 2 - 1; // -1..1
    out[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

export const mockChat: ChatProvider = {
  name: "mock",
  model: "mock-rag",
  async answer({ question, contexts }) {
    const snippets = contexts
      .slice(0, 3)
      .map((c, i) => `[${i + 1}] (${c.filename} #${c.chunkIndex}) ${truncate(c.text, 240)}`)
      .join("\n\n");
    const body =
      contexts.length === 0
        ? "No relevant context was retrieved. (Mock provider — no LLM key configured.)"
        : `Based on the retrieved context, here is a placeholder answer to your question:\n"${question}"\n\nTop sources:\n${snippets}`;
    return {
      answer: `[DEMO MODE]\n${body}`,
      provider: "mock",
      model: "mock-rag",
    };
  },
};

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
