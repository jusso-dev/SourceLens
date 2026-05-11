import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { withApi } from "@/lib/api";

export async function GET() {
  return withApi(async () => {
    const { workspace } = await requireCurrentWorkspace();
    const [docCount, indexed, failed, chunkCount, recentSearches, recentQuestions, jobCounts, avgIngest] =
      await Promise.all([
        prisma.document.count({ where: { workspaceId: workspace.id } }),
        prisma.document.count({ where: { workspaceId: workspace.id, status: "indexed" } }),
        prisma.document.count({ where: { workspaceId: workspace.id, status: "failed" } }),
        prisma.chunk.count({ where: { workspaceId: workspace.id } }),
        prisma.searchLog.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.question.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, question: true, provider: true, model: true, createdAt: true },
        }),
        prisma.ingestJob.groupBy({
          by: ["state"],
          where: { document: { workspaceId: workspace.id } },
          _count: { state: true },
        }),
        prisma.document.aggregate({
          where: { workspaceId: workspace.id, ingestDurationMs: { not: null } },
          _avg: { ingestDurationMs: true },
        }),
      ]);

    return {
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      documents: { total: docCount, indexed, failed },
      chunks: chunkCount,
      jobs: Object.fromEntries(jobCounts.map((j) => [j.state, j._count.state])),
      avgIngestMs: Math.round(avgIngest._avg.ingestDurationMs ?? 0),
      recentSearches,
      recentQuestions,
    };
  });
}
