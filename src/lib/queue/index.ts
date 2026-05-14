/**
 * Lazy, process-scoped Redis + BullMQ singletons.
 *
 * Next.js dev mode hot-reloads modules, so we store the connection on
 * `globalThis` to avoid creating a fresh socket on every request and
 * exhausting the Redis connection limit. The worker process imports the
 * same module and reuses the same connection.
 */

import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { currentTraceparent } from "@/lib/otel";
import { WEBHOOK_BACKOFF_DELAY_MS, WEBHOOK_MAX_ATTEMPTS } from "@/lib/webhooks/config";

export const INGEST_QUEUE = "ingest";
export const MAINTENANCE_QUEUE = "maintenance";
export const WEBHOOK_QUEUE = "webhook";

export interface IngestJobData {
  documentId: string;
  traceparent?: string;
}

export type MaintenanceJobData = { type: "audit-prune" };
export interface WebhookJobData {
  deliveryId: string;
}

interface QueueGlobals {
  __sourcelensRedis?: IORedis;
  __sourcelensIngestQueue?: Queue<IngestJobData>;
  __sourcelensIngestEvents?: QueueEvents;
  __sourcelensMaintenanceQueue?: Queue<MaintenanceJobData>;
  __sourcelensWebhookQueue?: Queue<WebhookJobData>;
}
const g = globalThis as unknown as QueueGlobals;

function attachErrorLog(redis: IORedis): IORedis {
  redis.on("error", (err) => {
    // ioredis emits frequent `error` events on transient blips; log without
    // crashing — the client retries automatically.
    console.error("[redis] connection error:", err.message);
  });
  return redis;
}

function createConnection(): IORedis {
  return attachErrorLog(
    new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    }),
  );
}

function connection(): IORedis {
  if (!g.__sourcelensRedis) g.__sourcelensRedis = createConnection();
  return g.__sourcelensRedis;
}

function asBullConnection(): ConnectionOptions {
  return connection();
}

export function getRawRedis(): IORedis {
  return connection();
}

export function getIngestQueue(): Queue<IngestJobData> {
  if (!g.__sourcelensIngestQueue) {
    g.__sourcelensIngestQueue = new Queue<IngestJobData>(INGEST_QUEUE, {
      connection: asBullConnection(),
    });
  }
  return g.__sourcelensIngestQueue;
}

/** Cached singleton. Earlier revisions created a fresh `QueueEvents` per call,
 *  which leaked a Redis subscription each time. */
export function getIngestEvents(): QueueEvents {
  if (!g.__sourcelensIngestEvents) {
    g.__sourcelensIngestEvents = new QueueEvents(INGEST_QUEUE, {
      connection: asBullConnection(),
    });
  }
  return g.__sourcelensIngestEvents;
}

export function getMaintenanceQueue(): Queue<MaintenanceJobData> {
  if (!g.__sourcelensMaintenanceQueue) {
    g.__sourcelensMaintenanceQueue = new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE, {
      connection: asBullConnection(),
    });
  }
  return g.__sourcelensMaintenanceQueue;
}

export function getWebhookQueue(): Queue<WebhookJobData> {
  if (!g.__sourcelensWebhookQueue) {
    g.__sourcelensWebhookQueue = new Queue<WebhookJobData>(WEBHOOK_QUEUE, {
      connection: asBullConnection(),
    });
  }
  return g.__sourcelensWebhookQueue;
}

export async function enqueueWebhookDelivery(deliveryId: string): Promise<string> {
  const job = await getWebhookQueue().add(
    "deliver-webhook",
    { deliveryId },
    {
      attempts: WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: WEBHOOK_BACKOFF_DELAY_MS },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
  if (!job.id) throw new Error("Failed to enqueue webhook delivery: missing job id");
  return job.id;
}

export async function registerMaintenanceJobs(): Promise<void> {
  await getMaintenanceQueue().add(
    "audit-prune",
    { type: "audit-prune" },
    {
      jobId: "audit-prune-daily",
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: { age: 24 * 3600, count: 30 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}

export async function enqueueIngest(documentId: string): Promise<string> {
  const queue = getIngestQueue();
  const job = await queue.add(
    "ingest-document",
    { documentId, traceparent: currentTraceparent() },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
  if (!job.id) throw new Error("Failed to enqueue ingest job: missing job id");
  return job.id;
}

/** Best-effort teardown for graceful shutdowns. Safe to call multiple times. */
export async function closeQueueResources(): Promise<void> {
  await Promise.allSettled([
    g.__sourcelensIngestEvents?.close(),
    g.__sourcelensIngestQueue?.close(),
    g.__sourcelensMaintenanceQueue?.close(),
    g.__sourcelensWebhookQueue?.close(),
    g.__sourcelensRedis?.quit(),
  ]);
  g.__sourcelensIngestEvents = undefined;
  g.__sourcelensIngestQueue = undefined;
  g.__sourcelensMaintenanceQueue = undefined;
  g.__sourcelensWebhookQueue = undefined;
  g.__sourcelensRedis = undefined;
}
