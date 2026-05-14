import { env } from "@/lib/env";
import { cohereReranker } from "./cohere";
import { noopReranker } from "./noop";
import { ollamaReranker } from "./ollama";
import { voyageReranker } from "./voyage";
import type { RerankCandidate, RerankScore, Reranker } from "../types";

export interface RerankResult {
  scores: RerankScore[];
  provider: string;
  model: string;
}

function configuredReranker(): Reranker {
  switch (env.reranker) {
    case "cohere":
      return cohereReranker;
    case "voyage":
      return voyageReranker;
    case "ollama":
      return ollamaReranker;
    case "none":
      return noopReranker;
    default:
      return noopReranker;
  }
}

export async function rerankCandidates(
  query: string,
  candidates: RerankCandidate[],
): Promise<RerankResult> {
  if (candidates.length === 0 || env.reranker === "none") {
    const scores = await noopReranker.rerank(query, candidates);
    return { scores, provider: noopReranker.name, model: noopReranker.model };
  }

  const reranker = configuredReranker();
  try {
    const scores = await reranker.rerank(query, candidates);
    return { scores, provider: reranker.name, model: reranker.model };
  } catch (err) {
    console.warn(`[providers] ${reranker.name} rerank failed, using pass-through order:`, err);
    const scores = await noopReranker.rerank(query, candidates);
    return { scores, provider: noopReranker.name, model: noopReranker.model };
  }
}

export { cohereReranker, noopReranker, ollamaReranker, voyageReranker };
