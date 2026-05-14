import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export function deletionDueAt(now = new Date()): Date {
  return new Date(now.getTime() + env.accountDeletionGraceDays * 24 * 60 * 60 * 1000);
}

export function deletionDelayMs(): number {
  return env.accountDeletionGraceDays * 24 * 60 * 60 * 1000;
}

export function issueDeletionCancelToken(): { token: string; expiresAt: Date } {
  return {
    token: randomBytes(32).toString("base64url"),
    expiresAt: deletionDueAt(),
  };
}

export async function runAccountDeletion(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionScheduledAt: true },
  });
  if (!user?.deletionScheduledAt || user.deletionScheduledAt > new Date()) return;

  await prisma.$transaction(async (tx) => {
    const ownedWorkspaces = await tx.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    for (const workspace of ownedWorkspaces) {
      const nextOwner = await tx.membership.findFirst({
        where: { workspaceId: workspace.id, userId: { not: userId }, role: { in: ["owner", "admin"] } },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      });
      if (nextOwner) {
        await tx.workspace.update({
          where: { id: workspace.id },
          data: { ownerId: nextOwner.userId },
        });
        if (nextOwner.role !== "owner") {
          await tx.membership.update({
            where: {
              userId_workspaceId: { userId: nextOwner.userId, workspaceId: workspace.id },
            },
            data: { role: "owner" },
          });
        }
      } else {
        await tx.workspace.delete({ where: { id: workspace.id } });
      }
    }

    const memberships = await tx.membership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    for (const membership of memberships) {
      const owner = await tx.workspace.findUnique({
        where: { id: membership.workspaceId },
        select: { ownerId: true },
      });
      if (!owner || owner.ownerId === userId) continue;
      await tx.document.updateMany({
        where: { workspaceId: membership.workspaceId, uploadedById: userId },
        data: { uploadedById: owner.ownerId },
      });
      await tx.question.updateMany({
        where: { workspaceId: membership.workspaceId, userId },
        data: { userId: owner.ownerId },
      });
      await tx.searchLog.updateMany({
        where: { workspaceId: membership.workspaceId, userId },
        data: { userId: owner.ownerId },
      });
    }

    await tx.auditLog.updateMany({ where: { actorId: userId }, data: { actorId: null } });
    await tx.apiToken.deleteMany({ where: { createdByUserId: userId } });
    await tx.membership.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });
}
