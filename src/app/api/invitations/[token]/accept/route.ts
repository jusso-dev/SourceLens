import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/server";
import { withApi, ApiError } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return withApi(async () => {
    const user = await requireUser();
    const invite = await prisma.invitation.findUnique({ where: { token } });
    if (!invite) throw new ApiError(404, "Invitation not found");
    if (invite.revokedAt) throw new ApiError(410, "Invitation revoked");
    if (invite.acceptedAt) throw new ApiError(410, "Invitation already accepted");
    if (invite.expiresAt < new Date()) throw new ApiError(410, "Invitation expired");

    // Normalise email comparison; better-auth stores email casing as entered.
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ApiError(403, `Invitation is for ${invite.email}; you are signed in as ${user.email}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: invite.workspaceId } },
        update: { role: invite.role },
        create: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { currentWorkspaceId: invite.workspaceId },
      });
    });

    return { ok: true, workspaceId: invite.workspaceId };
  });
}
