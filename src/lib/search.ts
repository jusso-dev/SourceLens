import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/providers";
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
}

const TOP_K = 20;
const KEYWORD_K = 25;
const VECTOR_K = 25;

export async function search(
  workspaceId: string,
  query: string,
  mode: SearchMode,
  filters: SearchFilters = {},
  limit = TOP_K,
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], mode, embeddingProvider: null };

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

  return { hits: merged.slice(0, limit), mode, embeddingProvider };
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

/** Reciprocal Rank Fusion. Both lists contribute, with k=60 a common default. */
function reciprocalRankFusion(a: SearchHit[], b: SearchHit[], k = 60): SearchHit[] {
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
