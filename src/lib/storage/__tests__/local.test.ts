import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { localStorage } from "../local";

const originalStorageDir = env.storageDir;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sourcelens-storage-"));
  env.storageDir = tempDir;
});

afterEach(async () => {
  env.storageDir = originalStorageDir;
  await fs.rm(tempDir, { force: true, recursive: true });
});

describe("localStorage", () => {
  it("stores paths relative to the storage root and reads the upload back", async () => {
    const stored = await localStorage.saveUpload("workspace_1", "notes.txt", Buffer.from("hello"));

    expect(stored.sizeBytes).toBe(5);
    expect(stored.storagePath).toMatch(/^workspace_1\//);
    expect(stored.storagePath).not.toContain("storage");

    await expect(localStorage.readUpload(stored.storagePath)).resolves.toEqual(Buffer.from("hello"));
  });

  it("still reads legacy paths that include the storage directory prefix", async () => {
    const full = path.join(tempDir, "workspace_1", "legacy.txt");
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, "legacy");

    const legacyPath = path.join(tempDir, "workspace_1", "legacy.txt");

    await expect(localStorage.readUpload(legacyPath)).resolves.toEqual(Buffer.from("legacy"));
  });
});
