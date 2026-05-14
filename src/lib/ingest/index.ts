import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedTexts } from "@/lib/providers";
import { readUpload } from "@/lib/storage";
import { withSpan } from "@/lib/otel";
import { chunkText } from "./chunk";
import { extractText } from "./extract";
import { toVectorLiteral } from "./vector";

export interface IngestStats {
  chunkCount: number;
  charCount: number;
  embeddingProvider: string;
  durationMs: number;
}

/** Per-statement batch size when inserting chunks via raw SQL. A multi-row
 *  INSERT keeps the transaction short and avoids a Prisma round-trip per row.
 *  Tuned for typical 10-100 chunk documents; very large docs split into
 *  multiple statements rather than building one query the server has to parse
 *  for hours. */
const CHUNK_INSERT_BATCH = 100;

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
  const { text, fileType } = await withSpan(
    "ingest.extract",
    { workspaceId: doc.workspaceId, documentId, fileType: doc.fileType },
    () => extractText(buffer, doc.filename, doc.mimeType),
  );
  if (!text.trim()) throw new Error("Extracted text is empty");

  const chunks = await withSpan(
    "ingest.chunk",
    { workspaceId: doc.workspaceId, documentId, charCount: text.length },
    async () => chunkText(text),
  );
  if (chunks.length === 0) throw new Error("No chunks produced");

  const { vectors, provider } = await withSpan(
    "ingest.embed.batch",
    { workspaceId: doc.workspaceId, documentId, chunkCount: chunks.length },
    async (span) => {
      const result = await embedTexts(chunks.map((c) => c.text));
      span.setAttribute("embeddingProvider", result.provider);
      return result;
    },
  );
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedding count mismatch: ${vectors.length} vs ${chunks.length}`);
  }

  // Replace any existing chunks for this document (re-ingest idempotency).
  // The whole replace-then-insert sequence runs in one transaction so a
  // mid-ingest failure cannot leave the index in a half-populated state.
  await withSpan(
    "ingest.insert",
    {
      workspaceId: doc.workspaceId,
      documentId,
      chunkCount: chunks.length,
      embeddingProvider: provider,
    },
    () =>
      prisma.$transaction(
        async (tx) => {
          // Re-verify the document still exists inside the transaction. Avoids the
          // FK-violation race where a user deletes the document between enqueue and
          // worker pickup.
          const fresh = await tx.document.findUnique({
            where: { id: documentId },
            select: { id: true },
          });
          if (!fresh) throw new Error(`Document ${documentId} was deleted before ingest completed`);

          await tx.chunk.deleteMany({ where: { documentId } });

          for (let i = 0; i < chunks.length; i += CHUNK_INSERT_BATCH) {
            const slice = chunks.slice(i, i + CHUNK_INSERT_BATCH);
            const values = slice.map((c, j) => {
              const idx = i + j;
              return Prisma.sql`(
                ${chunkId()},
                ${documentId},
                ${doc.workspaceId},
                ${c.index},
                ${c.text},
                ${c.charCount},
                '{}'::jsonb,
                ${toVectorLiteral(vectors[idx])}::vector,
                NOW()
              )`;
            });
            await tx.$executeRaw(
              Prisma.sql`
                INSERT INTO "Chunk" (
                  id, "documentId", "workspaceId", "chunkIndex",
                  "text", "charCount", metadata, embedding, "createdAt"
                )
                VALUES ${Prisma.join(values)}
              `,
            );
          }
        },
        { timeout: 60_000 },
      ),
  );

  const durationMs = Date.now() - t0;
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "indexed", fileType, ingestDurationMs: durationMs, error: null },
  });

  return {
    chunkCount: chunks.length,
    charCount: text.length,
    embeddingProvider: provider,
    durationMs,
  };
}

/** Collision-resistant 24-char id suitable for the `Chunk.id` text column.
 *  Crypto-strong: 12 bytes of entropy ≫ what a session can produce. */
function chunkId(): string {
  return `c${randomBytes(12).toString("hex")}`;
}

export async function markIngestFailure(documentId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  // The document may have been deleted while the job was queued; treat the
  // failure recorder as best-effort.
  await prisma.document
    .update({
      where: { id: documentId },
      data: { status: "failed", error: message.slice(0, 2000) },
    })
    .catch(() => undefined);
}
