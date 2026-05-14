import { prisma } from "@/lib/db";
import { authRateLimitKey, requireCurrentWorkspace, requireScope } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { audit } from "@/lib/audit";
import { enqueueIngest } from "@/lib/queue";
import { enforceRateLimit } from "@/lib/ratelimit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireCurrentWorkspace();
    requireScope(ctx, "documents:write");
    const { workspace, user } = ctx;
    await enforceRateLimit("retry", authRateLimitKey(ctx));
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc || doc.workspaceId !== workspace.id) throw new ApiError(404, "Not found");
    await prisma.document.update({
      where: { id },
      data: { status: "uploaded", error: null },
    });
    const jobId = await enqueueIngest(doc.id);
    await audit("document_retry", {
      workspaceId: workspace.id,
      actorId: user.id,
      targetType: "document",
      targetId: doc.id,
      metadata: { filename: doc.filename, jobId },
      request: req,
    });
    return { ok: true, jobId };
  });
}
