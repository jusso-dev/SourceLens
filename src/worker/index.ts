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
import { pruneAuditLogs } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { runAccountDeletion } from "@/lib/dsar/delete";
import { runDsarExport } from "@/lib/dsar/export";
import { ingestDocument, markIngestFailure } from "@/lib/ingest";
import { withSpan, withTraceparent } from "@/lib/otel";
import { deliverWebhook } from "@/lib/webhooks/dispatch";
import {
  INGEST_QUEUE,
  MAINTENANCE_QUEUE,
  PRIVACY_QUEUE,
  WEBHOOK_QUEUE,
  closeQueueResources,
  getRawRedis,
  registerMaintenanceJobs,
  type IngestJobData,
  type MaintenanceJobData,
  type PrivacyJobData,
  type WebhookJobData,
} from "@/lib/queue";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "2") || 2;

await registerMaintenanceJobs().catch((err) => {
  console.error("[worker] failed to register maintenance jobs:", err);
});

const ingestWorker = new Worker<IngestJobData>(
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

const maintenanceWorker = new Worker<MaintenanceJobData>(
  MAINTENANCE_QUEUE,
  async (job) => {
    if (job.data.type === "audit-prune") {
      const deleted = await pruneAuditLogs();
      return { deleted };
    }
    throw new Error(`Unknown maintenance job: ${JSON.stringify(job.data)}`);
  },
  {
    connection: getRawRedis(),
    concurrency: 1,
  },
);

const webhookWorker = new Worker<WebhookJobData>(
  WEBHOOK_QUEUE,
  async (job) => deliverWebhook(job.data.deliveryId),
  {
    connection: getRawRedis(),
    concurrency: 4,
  },
);

const privacyWorker = new Worker<PrivacyJobData>(
  PRIVACY_QUEUE,
  async (job) => {
    if (job.data.type === "dsar-export") {
      await runDsarExport(job.data.exportId, job.data.userId);
      return { exportId: job.data.exportId };
    }
    if (job.data.type === "account-delete") {
      await runAccountDeletion(job.data.userId);
      return { userId: job.data.userId };
    }
    throw new Error(`Unknown privacy job: ${JSON.stringify(job.data)}`);
  },
  {
    connection: getRawRedis(),
    concurrency: 1,
  },
);

ingestWorker.on("ready", () => {
  console.log(`[worker] ready queue=${INGEST_QUEUE} concurrency=${CONCURRENCY}`);
});
ingestWorker.on("active", (job) => {
  console.log(`[worker] job=${job.id} doc=${job.data.documentId} active`);
});
ingestWorker.on("failed", (job, err) => {
  console.error(`[worker] job=${job?.id} doc=${job?.data.documentId} failed:`, err.message);
});
ingestWorker.on("completed", (job) => {
  console.log(`[worker] job=${job.id} doc=${job.data.documentId} completed`);
});
ingestWorker.on("error", (err) => {
  // `error` differs from `failed` — it covers Redis disconnects, script
  // errors, etc., not per-job failures.
  console.error("[worker] worker error:", err);
});
maintenanceWorker.on("completed", (job, result) => {
  console.log(`[worker] maintenance job=${job.name} completed`, result);
});
maintenanceWorker.on("failed", (job, err) => {
  console.error(`[worker] maintenance job=${job?.name} failed:`, err.message);
});
maintenanceWorker.on("error", (err) => {
  console.error("[worker] maintenance worker error:", err);
});
webhookWorker.on("completed", (job) => {
  console.log(`[worker] webhook delivery=${job.data.deliveryId} completed`);
});
webhookWorker.on("failed", (job, err) => {
  console.error(`[worker] webhook delivery=${job?.data.deliveryId} failed:`, err.message);
});
webhookWorker.on("error", (err) => {
  console.error("[worker] webhook worker error:", err);
});
privacyWorker.on("completed", (job) => {
  console.log(`[worker] privacy job=${job.name} completed`);
});
privacyWorker.on("failed", (job, err) => {
  console.error(`[worker] privacy job=${job?.name} failed:`, err.message);
});
privacyWorker.on("error", (err) => {
  console.error("[worker] privacy worker error:", err);
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal}, draining…`);
  try {
    // `worker.close()` waits for in-flight jobs to complete (or be returned to
    // the queue) before resolving, giving us a clean drain.
    await Promise.allSettled([
      ingestWorker.close(),
      maintenanceWorker.close(),
      webhookWorker.close(),
      privacyWorker.close(),
    ]);
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
