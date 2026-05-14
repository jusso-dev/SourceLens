import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { saveUpload } from "@/lib/storage";
import { enqueueIngest } from "@/lib/queue";
import { enforceRateLimit } from "@/lib/ratelimit";
import { env } from "@/lib/env";
import { detectFileType, type ExtractedFileType } from "@/lib/ingest/extract";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_EXT = /\.(pdf|txt|md|markdown|docx)$/i;
const MAX_FILENAME_LEN = 255;

const CANONICAL_MIME: Record<ExtractedFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown",
  txt: "text/plain",
};

export async function GET() {
  return withApi(async () => {
    const { workspace } = await requireCurrentWorkspace();
    const documents = await prisma.document.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        fileType: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        error: true,
        ingestDurationMs: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chunks: true } },
      },
    });
    return { documents };
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
    await enforceRateLimit("upload", user.id);

    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart/form-data");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Missing file");

    const filename = sanitiseFilename(file.name);
    if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(filename)) {
      throw new ApiError(415, `Unsupported file type: ${file.type || filename}`);
    }
    if (file.size > env.maxUploadBytes) {
      throw new ApiError(413, `File too large (max ${env.maxUploadBytes} bytes)`);
    }
    if (file.size === 0) throw new ApiError(400, "Empty file");

    const fileType = detectFileType(filename, file.type);
    if (!fileType) throw new ApiError(415, `Unsupported file type: ${file.type || filename}`);

    const stored = await saveUpload(workspace.id, filename, file.stream(), {
      sizeBytes: file.size,
      contentType: file.type || CANONICAL_MIME[fileType],
    });

    const doc = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename,
        // Canonicalise the MIME to the type we actually classified — avoids
        // storing `application/txt` (invalid) for plain-text uploads with a
        // missing or generic `Content-Type` header.
        mimeType: file.type && ALLOWED_MIME.has(file.type) ? file.type : CANONICAL_MIME[fileType],
        fileType,
        storagePath: stored.storagePath,
        sizeBytes: stored.sizeBytes,
        status: "uploaded",
      },
    });

    await enqueueIngest(doc.id);

    return { document: doc };
  });
}

function sanitiseFilename(raw: string): string {
  // Drop any directory component a tricky client might have shipped, strip
  // NULs, and cap length so we don't blow the DB column.
  const base = raw.split(/[/\\]/).pop() ?? raw;
  return base.replace(/\0/g, "").slice(0, MAX_FILENAME_LEN);
}
