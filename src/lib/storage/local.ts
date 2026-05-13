import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/** Local-filesystem storage. Designed so the interface (save/read/delete) can later be
 *  swapped for S3 / R2 / Azure Blob without touching call sites. */
export interface StoredFile {
  storagePath: string;
  sizeBytes: number;
}

function root(): string {
  return path.resolve(process.cwd(), env.storageDir);
}

/** Resolve a stored path back to an absolute filesystem path and assert it sits
 *  inside the storage root. Defends against path traversal if a DB row's
 *  `storagePath` were ever tampered with (defence-in-depth). */
function resolveWithinRoot(storagePath: string): string {
  if (!storagePath || typeof storagePath !== "string") {
    throw new Error("storagePath must be a non-empty string");
  }
  const base = root();
  const full = path.resolve(base, storagePath);
  const rel = path.relative(base, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to access path outside storage root: ${storagePath}`);
  }
  return full;
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
  data: Buffer,
): Promise<StoredFile> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId)) {
    throw new Error("Invalid workspaceId for storage key");
  }
  const dir = path.join(root(), workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const { stem, ext } = sanitiseFilename(filename);
  const storageName = `${Date.now()}-${randomUUID()}-${stem}${ext}`;
  const full = path.join(dir, storageName);
  // Re-validate the absolute path before writing in case `workspaceId` somehow
  // contains traversal sequences slipped past the regex.
  if (!full.startsWith(`${root()}${path.sep}`)) {
    throw new Error("Computed storage path escaped root");
  }
  await fs.writeFile(full, data);
  return { storagePath: path.relative(process.cwd(), full), sizeBytes: data.byteLength };
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
