import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";
import {
  toNodeReadable,
  type StorageBackend,
  type StoredFile,
  type UploadBody,
} from "./types";

function root(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.storageDir);
}

/** Resolve a stored path back to an absolute filesystem path and assert it sits
 *  inside the storage root. Defends against path traversal if a DB row's
 *  `storagePath` were ever tampered with (defence-in-depth). */
function resolveWithinRoot(storagePath: string): string {
  if (!storagePath || typeof storagePath !== "string") {
    throw new Error("storagePath must be a non-empty string");
  }
  if (storagePath.startsWith("s3://")) {
    throw new Error("S3 storage paths cannot be read by the local backend");
  }
  const relativePath = normaliseLocalStoragePath(storagePath);
  const base = root();
  const full = path.resolve(/*turbopackIgnore: true*/ base, ...relativePath.split("/"));
  const rel = path.relative(base, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to access path outside storage root: ${storagePath}`);
  }
  return full;
}

function normaliseLocalStoragePath(storagePath: string): string {
  const normalised = storagePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  const storageDir = env.storageDir.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "");
  const legacyPrefix = storageDir ? `${storageDir}/` : "";
  const withoutLegacyPrefix =
    legacyPrefix && normalised.startsWith(legacyPrefix)
      ? normalised.slice(legacyPrefix.length)
      : normalised;
  const posix = path.posix.normalize(withoutLegacyPrefix);
  if (posix === "." || posix.startsWith("../") || posix === ".." || path.posix.isAbsolute(posix)) {
    throw new Error(`Refusing to access path outside storage root: ${storagePath}`);
  }
  return posix;
}

/** Strip the directory portion, drop characters that are unsafe in filenames,
 *  cap length, and return `{stem, ext}` for safe rejoining. */
function sanitiseFilename(filename: string): { stem: string; ext: string } {
  const cleaned = path.basename(filename).replace(/\0/g, "");
  const ext = path.extname(cleaned).slice(0, 16);
  const rawStem = path.basename(cleaned, ext);
  const stem = rawStem.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "file";
  return { stem, ext };
}

export async function saveUpload(
  workspaceId: string,
  filename: string,
  data: UploadBody,
): Promise<StoredFile> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId)) {
    throw new Error("Invalid workspaceId for storage key");
  }
  const dir = path.join(/*turbopackIgnore: true*/ root(), workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const { stem, ext } = sanitiseFilename(filename);
  const storageName = `${Date.now()}-${randomUUID()}-${stem}${ext}`;
  const full = path.join(/*turbopackIgnore: true*/ dir, storageName);
  // Re-validate the absolute path before writing in case `workspaceId` somehow
  // contains traversal sequences slipped past the regex.
  if (!full.startsWith(`${root()}${path.sep}`)) {
    throw new Error("Computed storage path escaped root");
  }
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.byteLength;
      callback(null, chunk);
    },
  });
  await pipeline(toNodeReadable(data), counter, createWriteStream(full, { flags: "wx" }));
  return {
    storagePath: path.posix.join(workspaceId, storageName),
    sizeBytes,
  };
}

export async function readUpload(storagePath: string): Promise<Buffer> {
  return fs.readFile(resolveWithinRoot(storagePath));
}

export async function deleteUpload(storagePath: string): Promise<void> {
  // `force: true` swallows ENOENT, which is the only outcome we'd want to
  // ignore. Any other error (permissions etc.) propagates so callers know
  // the file leaked.
  await fs.rm(resolveWithinRoot(storagePath), { force: true });
}

export const localStorage: StorageBackend = {
  saveUpload,
  readUpload,
  deleteUpload,
};
