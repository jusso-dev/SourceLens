import type { Reranker } from "../types";

export const noopReranker: Reranker = {
  name: "none",
  model: "pass-through",
  async rerank(_query, candidates) {
    return candidates.map((candidate, index) => ({
      chunkId: candidate.chunkId,
      score: candidate.score ?? 1 / (index + 1),
    }));
  },
};
