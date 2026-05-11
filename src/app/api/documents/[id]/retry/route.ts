import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { enqueueIngest } from "@/lib/queue";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { workspace } = await requireCurrentWorkspace();
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc || doc.workspaceId !== workspace.id) throw new ApiError(404, "Not found");
    await prisma.document.update({
      where: { id },
      data: { status: "uploaded", error: null },
    });
    const jobId = await enqueueIngest(doc.id);
    return { ok: true, jobId };
  });
}
