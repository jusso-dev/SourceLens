import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const { workspace } = await requireCurrentWorkspace();
    const jobs = await prisma.ingestJob.findMany({
      where: { document: { workspaceId: workspace.id } },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        document: { select: { id: true, filename: true, status: true } },
      },
    });
    return { jobs };
  });
}
