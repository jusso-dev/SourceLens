import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { deleteUpload } from "@/lib/storage";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { workspace } = await requireCurrentWorkspace();
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc || doc.workspaceId !== workspace.id) {
      throw new ApiError(404, "Not found");
    }
    await deleteUpload(doc.storagePath).catch(() => undefined);
    await prisma.document.delete({ where: { id } });
    return { ok: true };
  });
}
