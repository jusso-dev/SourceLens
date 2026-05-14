import { env } from "@/lib/env";
import type { Reranker } from "../types";

interface CohereRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

export const cohereReranker: Reranker = {
  name: "cohere",
  model: env.cohereRerankModel,
  async rerank(query, candidates) {
    if (!env.cohereApiKey) throw new Error("COHERE_API_KEY is required for RERANKER=cohere");
    const response = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.cohereApiKey}`,
        "content-type": "application/json",
        "x-client-name": "sourcelens",
      },
      body: JSON.stringify({
        model: env.cohereRerankModel,
        query,
        documents: candidates.map((candidate) => candidate.text),
        top_n: candidates.length,
      }),
    });
    if (!response.ok) {
      throw new Error(`Cohere rerank failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as CohereRerankResponse;
    return (data.results ?? []).map((result) => ({
      chunkId: candidates[result.index]?.chunkId ?? "",
      score: Number(result.relevance_score),
    })).filter((result) => result.chunkId);
  },
};
