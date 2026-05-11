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

export async function saveUpload(workspaceId: string, filename: string, data: Buffer): Promise<StoredFile> {
  const dir = path.join(root(), workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(filename) || "";
  const safeStem = path.basename(filename, ext).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
  const storageName = `${Date.now()}-${randomUUID()}-${safeStem}${ext}`;
  const full = path.join(dir, storageName);
  await fs.writeFile(full, data);
  return { storagePath: path.relative(process.cwd(), full), sizeBytes: data.byteLength };
}

export async function readUpload(storagePath: string): Promise<Buffer> {
  const full = path.resolve(process.cwd(), storagePath);
  return fs.readFile(full);
}

export async function deleteUpload(storagePath: string): Promise<void> {
  const full = path.resolve(process.cwd(), storagePath);
  await fs.rm(full, { force: true });
}
