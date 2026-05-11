-- Run after `prisma db push` (or after migrations) to add the vector index.
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw
  ON "Chunk"
  USING hnsw (embedding vector_cosine_ops);

-- Full-text expression index for keyword search.
CREATE INDEX IF NOT EXISTS chunk_text_fts
  ON "Chunk"
  USING gin (to_tsvector('english', "text"));
