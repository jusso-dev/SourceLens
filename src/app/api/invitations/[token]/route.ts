import { prisma } from "@/lib/db";
import { withApi, ApiError } from "@/lib/api";

/** Public lookup so the accept page can render workspace name + inviter
 *  without forcing the user to authenticate first. Returns only the safe fields. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return withApi(async () => {
    const invite = await prisma.invitation.findUnique({
      where: { token },
      include: {
        workspace: { select: { id: true, name: true, slug: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invite) throw new ApiError(404, "Invitation not found");
    if (invite.revokedAt) throw new ApiError(410, "Invitation revoked");
    if (invite.acceptedAt) throw new ApiError(410, "Invitation already accepted");
    if (invite.expiresAt < new Date()) throw new ApiError(410, "Invitation expired");
    return {
      workspace: invite.workspace,
      role: invite.role,
      email: invite.email,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
    };
  });
}
