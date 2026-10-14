import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteUpload } from "@/lib/storage";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
    const doc = await prisma.document.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });
    if (!doc || doc.workspaceId !== workspace.id) {
      throw new ApiError(404, "Not found");
    }
    await deleteUpload(doc.storagePath).catch(() => undefined);
    await prisma.document.delete({ where: { id } });
    await audit("document_delete", {
      workspaceId: workspace.id,
      actorId: user.id,
      targetType: "document",
      targetId: id,
      metadata: { filename: doc.filename, chunkCount: doc._count.chunks },
      request: req,
    });
    return { ok: true };
  });
}
