import { Queue, QueueEvents, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

export const INGEST_QUEUE = "ingest";

let _connection: IORedis | null = null;
let _queue: Queue<IngestJobData> | null = null;

export interface IngestJobData {
  documentId: string;
}

function connection(): ConnectionOptions {
  if (!_connection) {
    _connection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return _connection;
}

export function getRawRedis(): IORedis {
  connection();
  return _connection!;
}

export function getIngestQueue(): Queue<IngestJobData> {
  if (!_queue) {
    _queue = new Queue<IngestJobData>(INGEST_QUEUE, { connection: connection() });
  }
  return _queue;
}

export function getIngestEvents(): QueueEvents {
  return new QueueEvents(INGEST_QUEUE, { connection: connection() });
}

export async function enqueueIngest(documentId: string): Promise<string> {
  const queue = getIngestQueue();
  const job = await queue.add(
    "ingest-document",
    { documentId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
  return job.id!;
}
