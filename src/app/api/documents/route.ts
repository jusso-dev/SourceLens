import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { saveUpload } from "@/lib/storage/local";
import { enqueueIngest } from "@/lib/queue";
import { env } from "@/lib/env";

const ALLOWED_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_EXT = /\.(pdf|txt|md|markdown|docx)$/i;

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
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, "Expected multipart/form-data");
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "Missing file");

    if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(file.name)) {
      throw new ApiError(415, `Unsupported file type: ${file.type || file.name}`);
    }
    if (file.size > env.maxUploadBytes) {
      throw new ApiError(413, `File too large (max ${env.maxUploadBytes} bytes)`);
    }
    if (file.size === 0) throw new ApiError(400, "Empty file");

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await saveUpload(workspace.id, file.name, buffer);

    const lower = file.name.toLowerCase();
    const fileType = lower.endsWith(".pdf")
      ? "pdf"
      : lower.endsWith(".md") || lower.endsWith(".markdown")
        ? "md"
        : lower.endsWith(".docx")
          ? "docx"
          : "txt";

    const doc = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        uploadedById: user.id,
        filename: file.name,
        mimeType: file.type || `application/${fileType}`,
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

