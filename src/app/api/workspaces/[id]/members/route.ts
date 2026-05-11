import { prisma } from "@/lib/db";
import { requireWorkspaceAccess } from "@/lib/auth/server";
import { withApi } from "@/lib/api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    await requireWorkspaceAccess(id);
    const members = await prisma.membership.findMany({
      where: { workspaceId: id },
      include: { user: { select: { id: true, email: true, name: true, image: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    });
    return {
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        email: m.user.email,
        name: m.user.name,
        image: m.user.image,
        joinedAt: m.createdAt,
      })),
    };
  });
}
