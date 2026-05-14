import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/providers";
import { rerankCandidates } from "@/lib/providers/rerank";
import { toVectorLiteral } from "@/lib/ingest/vector";

export type SearchMode = "keyword" | "vector" | "hybrid";

export interface SearchFilters {
  documentIds?: string[];
  fileTypes?: string[];
}

export interface SearchHit {
  chunkId: string;
  documentId: string;
  filename: string;
  fileType: string;
  chunkIndex: number;
  text: string;
  score: number;
  source: "keyword" | "vector";
}

export interface SearchResult {
  hits: SearchHit[];
  mode: SearchMode;
  embeddingProvider: string | null;
  rerankerProvider: string | null;
  rerankerModel: string | null;
  timings: {
    retrievalMs: number;
    rerankMs: number;
  };
}

export interface SearchOptions {
  limit?: number;
  rerank?: boolean;
  rerankLimit?: number;
}

const TOP_K = 20;
const KEYWORD_K = 25;
const VECTOR_K = 25;

export async function search(
  workspaceId: string,
  query: string,
  mode: SearchMode,
  filters: SearchFilters = {},
  limitOrOptions: number | SearchOptions = TOP_K,
): Promise<SearchResult> {
  const q = query.trim();
  const options =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = options.limit ?? TOP_K;
  if (!q) {
    return {
      hits: [],
      mode,
      embeddingProvider: null,
      rerankerProvider: null,
      rerankerModel: null,
      timings: { retrievalMs: 0, rerankMs: 0 },
    };
  }

  const retrievalStarted = Date.now();
  let keywordHits: SearchHit[] = [];
  let vectorHits: SearchHit[] = [];
  let embeddingProvider: string | null = null;

  if (mode === "keyword" || mode === "hybrid") {
    keywordHits = await keywordSearch(workspaceId, q, filters, KEYWORD_K);
  }
  if (mode === "vector" || mode === "hybrid") {
    const { vectors, provider } = await embedTexts([q]);
    embeddingProvider = provider;
    vectorHits = await vectorSearch(workspaceId, vectors[0], filters, VECTOR_K);
  }

  let merged: SearchHit[];
  if (mode === "keyword") merged = keywordHits;
  else if (mode === "vector") merged = vectorHits;
  else merged = reciprocalRankFusion(keywordHits, vectorHits);

  const retrievalMs = Date.now() - retrievalStarted;
  let rerankMs = 0;
  let rerankerProvider: string | null = null;
  let rerankerModel: string | null = null;

  if (options.rerank && merged.length > 1) {
    const rerankStarted = Date.now();
    const reranked = await rerankSearchHits(q, merged, options.rerankLimit ?? TOP_K);
    merged = reranked.hits;
    rerankerProvider = reranked.provider;
    rerankerModel = reranked.model;
    rerankMs = Date.now() - rerankStarted;
  }

  return {
    hits: merged.slice(0, limit),
    mode,
    embeddingProvider,
    rerankerProvider,
    rerankerModel,
    timings: { retrievalMs, rerankMs },
  };
}

async function rerankSearchHits(
  query: string,
  hits: SearchHit[],
  rerankLimit: number,
): Promise<{ hits: SearchHit[]; provider: string; model: string }> {
  const candidates = hits.slice(0, rerankLimit);
  const { scores, provider, model } = await rerankCandidates(
    query,
    candidates.map((hit) => ({
      chunkId: hit.chunkId,
      text: hit.text,
      score: hit.score,
    })),
  );

  const hitById = new Map(candidates.map((hit) => [hit.chunkId, hit]));
  const rankedIds = new Set<string>();
  const reranked = scores.flatMap((score) => {
    const hit = hitById.get(score.chunkId);
    if (!hit) return [];
    rankedIds.add(score.chunkId);
    return [{ ...hit, score: score.score }];
  });
  const missing = candidates.filter((hit) => !rankedIds.has(hit.chunkId));
  const untouched = hits.slice(candidates.length);
  return { hits: [...reranked, ...missing, ...untouched], provider, model };
}

async function keywordSearch(
  workspaceId: string,
  query: string,
  filters: SearchFilters,
  k: number,
): Promise<SearchHit[]> {
  // Postgres websearch_to_tsquery is forgiving with user input.
  const docFilter = filters.documentIds?.length
    ? Prisma.sql`AND c."documentId" = ANY(${filters.documentIds}::text[])`
    : Prisma.empty;
  const typeFilter = filters.fileTypes?.length
    ? Prisma.sql`AND d."fileType" = ANY(${filters.fileTypes}::text[])`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      filename: string;
      fileType: string;
      chunkIndex: number;
      text: string;
      rank: number;
    }>
  >(Prisma.sql`
    SELECT c.id, c."documentId", d.filename, d."fileType", c."chunkIndex", c.text,
           ts_rank(to_tsvector('english', c.text), websearch_to_tsquery('english', ${query})) AS rank
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE c."workspaceId" = ${workspaceId}
      AND to_tsvector('english', c.text) @@ websearch_to_tsquery('english', ${query})
      ${docFilter}
      ${typeFilter}
    ORDER BY rank DESC
    LIMIT ${k}
  `);

  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.documentId,
    filename: r.filename,
    fileType: r.fileType,
    chunkIndex: r.chunkIndex,
    text: r.text,
    score: Number(r.rank),
    source: "keyword" as const,
  }));
}

async function vectorSearch(
  workspaceId: string,
  vector: number[],
  filters: SearchFilters,
  k: number,
): Promise<SearchHit[]> {
  const vec = toVectorLiteral(vector);
  const docFilter = filters.documentIds?.length
    ? Prisma.sql`AND c."documentId" = ANY(${filters.documentIds}::text[])`
    : Prisma.empty;
  const typeFilter = filters.fileTypes?.length
    ? Prisma.sql`AND d."fileType" = ANY(${filters.fileTypes}::text[])`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      documentId: string;
      filename: string;
      fileType: string;
      chunkIndex: number;
      text: string;
      distance: number;
    }>
  >(Prisma.sql`
    SELECT c.id, c."documentId", d.filename, d."fileType", c."chunkIndex", c.text,
           (c.embedding <=> ${vec}::vector) AS distance
    FROM "Chunk" c
    JOIN "Document" d ON d.id = c."documentId"
    WHERE c."workspaceId" = ${workspaceId}
      AND c.embedding IS NOT NULL
      ${docFilter}
      ${typeFilter}
    ORDER BY c.embedding <=> ${vec}::vector ASC
    LIMIT ${k}
  `);

  return rows.map((r) => ({
    chunkId: r.id,
    documentId: r.documentId,
    filename: r.filename,
    fileType: r.fileType,
    chunkIndex: r.chunkIndex,
    text: r.text,
    score: 1 - Number(r.distance), // cosine similarity for display
    source: "vector" as const,
  }));
}

/** Reciprocal Rank Fusion. Both lists contribute, with k=60 a common default.
 *  Exported for unit testing. */
export function reciprocalRankFusion(a: SearchHit[], b: SearchHit[], k = 60): SearchHit[] {
  const scores = new Map<string, { hit: SearchHit; score: number }>();
  for (const list of [a, b]) {
    list.forEach((hit, idx) => {
      const prev = scores.get(hit.chunkId);
      const contribution = 1 / (k + idx + 1);
      if (prev) {
        prev.score += contribution;
      } else {
        scores.set(hit.chunkId, { hit, score: contribution });
      }
    });
  }
  return [...scores.values()]
    .sort((x, y) => y.score - x.score)
    .map(({ hit, score }) => ({ ...hit, score }));
}
