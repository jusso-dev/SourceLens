import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
import {
  knownByteLength,
  toNodeReadable,
  type SaveUploadOptions,
  type StorageBackend,
  type StoredFile,
  type UploadBody,
} from "./types";

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!env.s3Bucket) throw new Error("S3_BUCKET is required when STORAGE_BACKEND=s3");
  if (!env.s3Region) throw new Error("S3_REGION is required when STORAGE_BACKEND=s3");
  if (!client) {
    client = new S3Client({
      endpoint: env.s3Endpoint || undefined,
      region: env.s3Region,
      forcePathStyle: env.s3ForcePathStyle,
      credentials:
        env.s3AccessKeyId && env.s3SecretAccessKey
          ? {
              accessKeyId: env.s3AccessKeyId,
              secretAccessKey: env.s3SecretAccessKey,
            }
          : undefined,
    });
  }
  return client;
}

function sanitiseFilename(filename: string): { stem: string; ext: string } {
  const cleaned = path.basename(filename).replace(/\0/g, "");
  const ext = path.extname(cleaned).slice(0, 16);
  const rawStem = path.basename(cleaned, ext);
  const stem = rawStem.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "file";
  return { stem, ext };
}

function makeKey(workspaceId: string, filename: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId)) {
    throw new Error("Invalid workspaceId for storage key");
  }
  const { stem, ext } = sanitiseFilename(filename);
  return `${workspaceId}/${Date.now()}-${randomUUID()}-${stem}${ext}`;
}

function parseStoragePath(storagePath: string): { bucket: string; key: string } {
  if (!storagePath.startsWith("s3://")) {
    throw new Error(`Expected s3:// storage path, got: ${storagePath}`);
  }
  const url = new URL(storagePath);
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!url.hostname || !key) throw new Error(`Invalid S3 storage path: ${storagePath}`);
  return { bucket: url.hostname, key };
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const maybeSdkStream = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof maybeSdkStream.transformToByteArray === "function") {
    return Buffer.from(await maybeSdkStream.transformToByteArray());
  }
  throw new Error("Unsupported S3 response body");
}

export async function saveUpload(
  workspaceId: string,
  filename: string,
  data: UploadBody,
  options: SaveUploadOptions = {},
): Promise<StoredFile> {
  const bucket = env.s3Bucket;
  if (!bucket) throw new Error("S3_BUCKET is required when STORAGE_BACKEND=s3");
  const key = makeKey(workspaceId, filename);
  const sizeBytes = options.sizeBytes ?? knownByteLength(data);
  let uploadedBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      uploadedBytes += chunk.byteLength;
      callback(null, chunk);
    },
  });

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: toNodeReadable(data).pipe(counter),
      ContentLength: sizeBytes,
      ContentType: options.contentType || undefined,
    }),
  );

  return {
    storagePath: `s3://${bucket}/${key}`,
    sizeBytes: sizeBytes ?? uploadedBytes,
  };
}

export async function readUpload(storagePath: string): Promise<Buffer> {
  const { bucket, key } = parseStoragePath(storagePath);
  const response = await getClient().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return streamToBuffer(response.Body);
}

export async function deleteUpload(storagePath: string): Promise<void> {
  const { bucket, key } = parseStoragePath(storagePath);
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export const s3Storage: StorageBackend = {
  saveUpload,
  readUpload,
  deleteUpload,
};
