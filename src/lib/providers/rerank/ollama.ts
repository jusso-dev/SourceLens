import { env } from "@/lib/env";
import type { Reranker } from "../types";

interface OllamaRerankResponse {
  results?: Array<{ index: number; relevance_score?: number; score?: number }>;
}

export const ollamaReranker: Reranker = {
  name: "ollama",
  model: env.ollamaRerankModel,
  async rerank(query, candidates) {
    const response = await fetch(`${env.ollamaHost.replace(/\/+$/, "")}/api/rerank`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: env.ollamaRerankModel,
        query,
        documents: candidates.map((candidate) => candidate.text),
        top_n: candidates.length,
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama rerank failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as OllamaRerankResponse;
    return (data.results ?? []).map((result) => ({
      chunkId: candidates[result.index]?.chunkId ?? "",
      score: Number(result.relevance_score ?? result.score ?? 0),
    })).filter((result) => result.chunkId);
  },
};
