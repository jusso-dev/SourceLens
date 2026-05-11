import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/providers";
import { readUpload } from "@/lib/storage/local";
import { chunkText } from "./chunk";
import { extractText } from "./extract";
import { toVectorLiteral } from "./vector";

export interface IngestStats {
  chunkCount: number;
  charCount: number;
  embeddingProvider: string;
  durationMs: number;
}

/** Ingest a document by id: extract → chunk → embed → persist.
 *  Updates the Document.status as it progresses; throws on hard failure
 *  so the BullMQ worker can mark the IngestJob row as failed. */
export async function ingestDocument(documentId: string): Promise<IngestStats> {
  const t0 = Date.now();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  await prisma.document.update({
    where: { id: documentId },
    data: { status: "processing", error: null },
  });

  const buffer = await readUpload(doc.storagePath);
  const { text, fileType } = await extractText(buffer, doc.filename, doc.mimeType);
  if (!text.trim()) throw new Error("Extracted text is empty");

  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("No chunks produced");

  const { vectors, provider } = await embedTexts(chunks.map((c) => c.text));
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedding count mismatch: ${vectors.length} vs ${chunks.length}`);
  }

  // Replace any existing chunks for this document (re-ingest idempotency).
  await prisma.chunk.deleteMany({ where: { documentId } });

  // Insert chunks in a single transaction; embedding column is pgvector → raw SQL.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const vec = toVectorLiteral(vectors[i]);
      await tx.$executeRaw`
        INSERT INTO "Chunk" (id, "documentId", "workspaceId", "chunkIndex", "text", "charCount", metadata, embedding, "createdAt")
        VALUES (
          ${cuid()},
          ${documentId},
          ${doc.workspaceId},
          ${c.index},
          ${c.text},
          ${c.charCount},
          ${Prisma.sql`'{}'::jsonb`},
          ${vec}::vector,
          NOW()
        )
      `;
    }
  });

  const durationMs = Date.now() - t0;
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "indexed", fileType, ingestDurationMs: durationMs, error: null },
  });

  return { chunkCount: chunks.length, charCount: text.length, embeddingProvider: provider, durationMs };
}

/** Lightweight cuid-ish id (avoids pulling in cuid lib in raw INSERT). */
function cuid(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `c${t}${r}`;
}

export async function markIngestFailure(documentId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "failed", error: message.slice(0, 2000) },
  });
}
