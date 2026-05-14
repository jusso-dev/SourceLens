import { audit } from "@/lib/audit";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; tokenId: string }> },
) {
  const { id, tokenId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const token = await prisma.apiToken.findUnique({ where: { id: tokenId } });
    if (!token || token.workspaceId !== id) throw new ApiError(404, "Token not found");
    const revoked = await prisma.apiToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
    await audit("auth_token_revoke", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "api_token",
      targetId: revoked.id,
      metadata: { name: revoked.name, prefix: revoked.prefix },
      request: req,
    });
    return { ok: true };
  });
}
