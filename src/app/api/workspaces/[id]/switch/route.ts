import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/auth/server";
import { withApi } from "@/lib/api";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { user } = await requireWorkspaceAccess(id);
    await prisma.user.update({
      where: { id: user.id },
      data: { currentWorkspaceId: id },
    });
    return { ok: true };
  });
}
