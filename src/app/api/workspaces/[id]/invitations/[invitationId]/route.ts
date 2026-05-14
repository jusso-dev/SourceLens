import { prisma } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { audit } from "@/lib/audit";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  return withApi(async () => {
    const { user } = await requireWorkspaceRole(id, "admin");
    const invite = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invite || invite.workspaceId !== id) throw new ApiError(404, "Invitation not found");
    await prisma.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    await audit("membership_remove", {
      workspaceId: id,
      actorId: user.id,
      targetType: "invitation",
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role, reason: "invite_revoked" },
      request: req,
    });
    return { ok: true };
  });
}
