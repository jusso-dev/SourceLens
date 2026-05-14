import { env } from "@/lib/env";
import type { Reranker } from "../types";

interface VoyageRerankResponse {
  results?: Array<{ index: number; relevance_score: number }>;
}

export const voyageReranker: Reranker = {
  name: "voyage",
  model: env.voyageRerankModel,
  async rerank(query, candidates) {
    if (!env.voyageApiKey) throw new Error("VOYAGE_API_KEY is required for RERANKER=voyage");
    const response = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.voyageApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.voyageRerankModel,
        query,
        documents: candidates.map((candidate) => candidate.text),
        top_k: candidates.length,
        return_documents: false,
        truncation: true,
      }),
    });
    if (!response.ok) {
      throw new Error(`Voyage rerank failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as VoyageRerankResponse;
    return (data.results ?? []).map((result) => ({
      chunkId: candidates[result.index]?.chunkId ?? "",
      score: Number(result.relevance_score),
    })).filter((result) => result.chunkId);
  },
};
