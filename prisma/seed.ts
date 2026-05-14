/** Seed demo data: a demo user, their auto-created workspace, three sample
 *  documents, and pre-indexed chunks so the app is demo-ready in seconds. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

import { auth } from "../src/lib/auth";
import { env } from "../src/lib/env";
import { chunkText } from "../src/lib/ingest/chunk";
import { toVectorLiteral } from "../src/lib/ingest/vector";
import { embedTexts } from "../src/lib/providers";
import { saveUpload } from "../src/lib/storage";

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@sourcelens.dev";
const DEMO_PASSWORD = "sourcelens-demo";
const DEMO_NAME = "Demo User";

const SAMPLES = [
  {
    filename: "pgvector-overview.md",
    body: `# pgvector overview

pgvector is a Postgres extension that adds a \`vector\` data type and
distance operators for nearest-neighbour search. It supports cosine
distance (\`<=>\`), inner product (\`<#>\`) and L2 distance (\`<->\`).

For approximate nearest-neighbour queries pgvector supports HNSW and
IVFFlat indexes. HNSW is generally preferred for read-heavy workloads
because it has good recall and constant-time inserts.

SourceLens stores chunk embeddings as a \`vector(768)\` column and
queries them with cosine distance, which is the standard choice for
sentence-embedding models such as nomic-embed-text.`,
  },
  {
    filename: "bullmq-ingestion.md",
    body: `# BullMQ ingestion pipeline

The SourceLens worker is a BullMQ consumer that pulls jobs from the
\`ingest\` queue. Each job carries a single \`documentId\`. The pipeline
performs four steps: extract text from the source file, chunk it on
paragraph boundaries with overlap, embed each chunk via the provider
chain, and insert chunks with vectors into Postgres in a single
transaction.

Failures are retried with exponential backoff (5s, 25s, 125s). After
three failed attempts the job is marked failed and the document
\`status\` column flips to \`failed\` with the error message stored
alongside.`,
  },
  {
    filename: "rag-citations.md",
    body: `# Citations in retrieval-augmented answers

A retrieval-augmented answer is only useful if the user can trace each
claim back to a source. SourceLens persists every (question, answer)
pair together with the ordered list of citations and the retrieval
score of the top chunk.

Citations include the chunk id, document id, filename and 1-indexed
position number. The Ask page renders sources directly under the
answer so reviewers can verify any sentence against its origin.`,
  },
];

async function main() {
  console.log("→ Seeding demo data…");
  mkdirSync(path.resolve(process.cwd(), env.storageDir), { recursive: true });

  // 1. demo user (idempotent)
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    console.log("  creating demo user");
    const result = await auth.api.signUpEmail({
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME },
    });
    if (!result?.user) throw new Error("Failed to create demo user");
    user = await prisma.user.findUnique({ where: { id: result.user.id } });
    if (!user) throw new Error("Demo user not found after sign-up");
  } else {
    console.log("  demo user exists");
  }

  // 2. workspace (created by the better-auth user.create hook; assert presence)
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
  });
  if (!membership) throw new Error("Demo workspace missing — auth hook misconfigured");
  const workspace = membership.workspace;
  console.log(`  workspace: ${workspace.name} (${workspace.slug})`);

  // 3. sample documents + chunks
  const existing = await prisma.document.count({ where: { workspaceId: workspace.id } });
  if (existing > 0) {
    console.log(`  ${existing} documents already present, skipping document seed`);
  } else {
    for (const sample of SAMPLES) {
      const buffer = Buffer.from(sample.body, "utf8");
      const stored = await saveUpload(workspace.id, sample.filename, buffer);
      const doc = await prisma.document.create({
        data: {
          workspaceId: workspace.id,
          uploadedById: user.id,
          filename: sample.filename,
          mimeType: "text/markdown",
          fileType: "md",
          storagePath: stored.storagePath,
          sizeBytes: stored.sizeBytes,
          status: "processing",
        },
      });

      const chunks = chunkText(sample.body, { targetChars: 800, overlapChars: 80 });
      const { vectors, provider } = await embedTexts(chunks.map((c) => c.text));
      console.log(`  indexing ${sample.filename} (${chunks.length} chunks, provider=${provider})`);

      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          await tx.$executeRaw`
            INSERT INTO "Chunk" (id, "documentId", "workspaceId", "chunkIndex", "text", "charCount", metadata, embedding, "createdAt")
            VALUES (
              ${`c_seed_${doc.id}_${i}`},
              ${doc.id},
              ${workspace.id},
              ${c.index},
              ${c.text},
              ${c.charCount},
              '{}'::jsonb,
              ${toVectorLiteral(vectors[i])}::vector,
              NOW()
            )
          `;
        }
      });

      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "indexed", ingestDurationMs: 0 },
      });
    }
  }

  // 4. write a sample plain-text upload file for the user to try drag-and-drop
  const sampleTxt = path.resolve(process.cwd(), "sample-uploads/welcome.txt");
  try {
    mkdirSync(path.dirname(sampleTxt), { recursive: true });
    writeFileSync(
      sampleTxt,
      "Welcome to SourceLens.\nUpload this file via the Documents page to test the ingestion pipeline.\n",
    );
  } catch {
    /* ignore */
  }

  console.log("\nSeed complete.");
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
