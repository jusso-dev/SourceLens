import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export interface StoredFile {
  storagePath: string;
  sizeBytes: number;
}

export interface SaveUploadOptions {
  sizeBytes?: number;
  contentType?: string;
}

export type UploadBody =
  | Buffer
  | Uint8Array
  | Readable
  | ReadableStream<Uint8Array>
  | Blob;

export interface StorageBackend {
  saveUpload(
    workspaceId: string,
    filename: string,
    data: UploadBody,
    options?: SaveUploadOptions,
  ): Promise<StoredFile>;
  readUpload(storagePath: string): Promise<Buffer>;
  deleteUpload(storagePath: string): Promise<void>;
}

export function knownByteLength(data: UploadBody): number | undefined {
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return undefined;
}

export function toNodeReadable(data: UploadBody): Readable {
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
    return Readable.from([data]);
  }
  if (data instanceof Readable) return data;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return Readable.fromWeb(data.stream() as unknown as NodeReadableStream<Uint8Array>);
  }
  if (typeof ReadableStream !== "undefined" && data instanceof ReadableStream) {
    return Readable.fromWeb(data as unknown as NodeReadableStream<Uint8Array>);
  }
  throw new Error("Unsupported upload body");
}
