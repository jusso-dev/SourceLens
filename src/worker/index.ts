import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { ingestDocument, markIngestFailure } from "@/lib/ingest";
import { INGEST_QUEUE, getRawRedis, type IngestJobData } from "@/lib/queue";

const worker = new Worker<IngestJobData>(
  INGEST_QUEUE,
  async (job) => {
    const { documentId } = job.data;
    await prisma.ingestJob.upsert({
      where: { bullJobId: String(job.id) },
      update: { state: "active", attempts: job.attemptsMade + 1, startedAt: new Date() },
      create: {
        bullJobId: String(job.id),
        documentId,
        state: "active",
        attempts: job.attemptsMade + 1,
        startedAt: new Date(),
      },
    });

    try {
      const stats = await ingestDocument(documentId);
      await prisma.ingestJob.update({
        where: { bullJobId: String(job.id) },
        data: {
          state: "completed",
          finishedAt: new Date(),
          durationMs: stats.durationMs,
        },
      });
      return stats;
    } catch (err) {
      await markIngestFailure(documentId, err);
      await prisma.ingestJob.update({
        where: { bullJobId: String(job.id) },
        data: {
          state: "failed",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
        },
      });
      throw err;
    }
  },
  {
    connection: getRawRedis(),
    concurrency: 2,
  },
);

worker.on("ready", () => {
  console.log(`[worker] ready on queue=${INGEST_QUEUE}`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});
worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed for doc=${job.data.documentId}`);
});

async function shutdown() {
  console.log("[worker] shutting down...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Add a unique index on bullJobId at runtime (Prisma schema does not currently mark it
// unique — keep the worker self-healing). Cheap, fires once per process.
prisma.ingestJob
  .findFirst()
  .catch(() => {
    /* table may not exist yet on first boot; migrations will create it */
  });
