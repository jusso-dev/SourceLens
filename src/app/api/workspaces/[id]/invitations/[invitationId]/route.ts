import { prisma } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; invitationId: string }> },
) {
  const { id, invitationId } = await params;
  return withApi(async () => {
    await requireWorkspaceRole(id, "admin");
    const invite = await prisma.invitation.findUnique({ where: { id: invitationId } });
    if (!invite || invite.workspaceId !== id) throw new ApiError(404, "Invitation not found");
    await prisma.invitation.update({
      where: { id: invitationId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  });
}
