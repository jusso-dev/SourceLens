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

export const INGEST_QUEUE = "ingest";

export interface IngestJobData {
  documentId: string;
  traceparent?: string;
}

interface QueueGlobals {
  __sourcelensRedis?: IORedis;
  __sourcelensIngestQueue?: Queue<IngestJobData>;
  __sourcelensIngestEvents?: QueueEvents;
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
    g.__sourcelensRedis?.quit(),
  ]);
  g.__sourcelensIngestEvents = undefined;
  g.__sourcelensIngestQueue = undefined;
  g.__sourcelensRedis = undefined;
}
