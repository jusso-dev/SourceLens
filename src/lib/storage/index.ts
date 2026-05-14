import { env } from "@/lib/env";
import { localStorage } from "./local";
import { s3Storage } from "./s3";
import type { SaveUploadOptions, StorageBackend, UploadBody } from "./types";

function selectedStorage(): StorageBackend {
  switch (env.storageBackend) {
    case "local":
      return localStorage;
    case "s3":
      return s3Storage;
    case "azure":
      throw new Error("STORAGE_BACKEND=azure is not implemented yet");
    default:
      return localStorage;
  }
}

function storageForPath(storagePath: string): StorageBackend {
  if (storagePath.startsWith("s3://")) return s3Storage;
  return localStorage;
}

export function saveUpload(
  workspaceId: string,
  filename: string,
  data: UploadBody,
  options?: SaveUploadOptions,
) {
  return selectedStorage().saveUpload(workspaceId, filename, data, options);
}

export function readUpload(storagePath: string) {
  return storageForPath(storagePath).readUpload(storagePath);
}

export function deleteUpload(storagePath: string) {
  return storageForPath(storagePath).deleteUpload(storagePath);
}

export type { SaveUploadOptions, StoredFile, StorageBackend, UploadBody } from "./types";
