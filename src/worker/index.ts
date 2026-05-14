/**
 * BullMQ worker entry point.
 *
 * Consumes the `ingest` queue, runs the ingest pipeline for each document,
 * and mirrors the lifecycle into the `IngestJob` table for the dashboard.
 * Run via `pnpm worker` — distinct from the Next.js HTTP process.
 */

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  await import("@/instrumentation.node");
}

import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { ingestDocument, markIngestFailure } from "@/lib/ingest";
import { withSpan, withTraceparent } from "@/lib/otel";
import {
  INGEST_QUEUE,
  closeQueueResources,
  getRawRedis,
  type IngestJobData,
} from "@/lib/queue";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "2") || 2;

const worker = new Worker<IngestJobData>(
  INGEST_QUEUE,
  async (job) => {
    const { documentId } = job.data;
    if (!job.id) throw new Error("Worker received a job with no id");
    const bullJobId = String(job.id);

    await prisma.ingestJob.upsert({
      where: { bullJobId },
      update: { state: "active", attempts: job.attemptsMade + 1, startedAt: new Date() },
      create: {
        bullJobId,
        documentId,
        state: "active",
        attempts: job.attemptsMade + 1,
        startedAt: new Date(),
      },
    });

    try {
      const stats = await withTraceparent(job.data.traceparent, () =>
        withSpan(
          "ingest.job",
          { documentId, bullJobId, "bullmq.queue": INGEST_QUEUE, attempts: job.attemptsMade + 1 },
          () => ingestDocument(documentId),
        ),
      );
      await prisma.ingestJob.update({
        where: { bullJobId },
        data: {
          state: "completed",
          finishedAt: new Date(),
          durationMs: stats.durationMs,
        },
      });
      return stats;
    } catch (err) {
      await markIngestFailure(documentId, err);
      await prisma.ingestJob
        .update({
          where: { bullJobId },
          data: {
            state: "failed",
            finishedAt: new Date(),
            error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
          },
        })
        .catch((updateErr) => {
          // Don't mask the original failure if the bookkeeping write fails too.
          console.error("[worker] failed to record IngestJob failure:", updateErr);
        });
      throw err;
    }
  },
  {
    connection: getRawRedis(),
    concurrency: CONCURRENCY,
  },
);

worker.on("ready", () => {
  console.log(`[worker] ready queue=${INGEST_QUEUE} concurrency=${CONCURRENCY}`);
});
worker.on("active", (job) => {
  console.log(`[worker] job=${job.id} doc=${job.data.documentId} active`);
});
worker.on("failed", (job, err) => {
  console.error(`[worker] job=${job?.id} doc=${job?.data.documentId} failed:`, err.message);
});
worker.on("completed", (job) => {
  console.log(`[worker] job=${job.id} doc=${job.data.documentId} completed`);
});
worker.on("error", (err) => {
  // `error` differs from `failed` — it covers Redis disconnects, script
  // errors, etc., not per-job failures.
  console.error("[worker] worker error:", err);
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, draining…`);
  try {
    // `worker.close()` waits for in-flight jobs to complete (or be returned to
    // the queue) before resolving, giving us a clean drain.
    await worker.close();
    await closeQueueResources();
    await prisma.$disconnect();
  } catch (err) {
    console.error("[worker] shutdown error:", err);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err);
});
