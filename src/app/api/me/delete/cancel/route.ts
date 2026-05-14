import { audit } from "@/lib/audit";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  return withApi(async () => {
    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token) throw new ApiError(400, "Missing cancellation token");
    const user = await prisma.user.findUnique({
      where: { deletionCancelToken: body.token },
      select: { id: true, deletionCancelTokenExpiresAt: true },
    });
    if (!user || !user.deletionCancelTokenExpiresAt || user.deletionCancelTokenExpiresAt < new Date()) {
      throw new ApiError(404, "Cancellation token not found or expired");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        deletionScheduledAt: null,
        deletionCancelledAt: new Date(),
        deletionCancelToken: null,
        deletionCancelTokenExpiresAt: null,
      },
    });
    await audit("account_deletion_cancel", {
      actorId: user.id,
      targetType: "user",
      targetId: user.id,
      metadata: {},
      request: req,
    });
    return { ok: true };
  });
}
