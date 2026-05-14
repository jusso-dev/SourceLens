import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deletionDelayMs, deletionDueAt, issueDeletionCancelToken } from "@/lib/dsar/delete";
import { enqueueAccountDeletion } from "@/lib/queue";

export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { deletionScheduledAt: true },
    });
    if (existing?.deletionScheduledAt) throw new ApiError(409, "Account deletion is already scheduled");

    const { token, expiresAt } = issueDeletionCancelToken();
    const scheduledAt = deletionDueAt();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        deletionScheduledAt: scheduledAt,
        deletionCancelledAt: null,
        deletionCancelToken: token,
        deletionCancelTokenExpiresAt: expiresAt,
      },
    });
    const jobId = await enqueueAccountDeletion(user.id, deletionDelayMs());
    await audit("account_deletion_schedule", {
      actorId: user.id,
      targetType: "user",
      targetId: user.id,
      metadata: { scheduledAt: scheduledAt.toISOString(), jobId },
      request: req,
    });
    return { ok: true, scheduledAt, cancelToken: token };
  });
}
