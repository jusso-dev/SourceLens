import { prisma } from "@/lib/db";

export async function getWorkspaceStats(workspaceId: string) {
  const [
    docCount,
    indexed,
    failed,
    chunkCount,
    recentSearches,
    recentQuestions,
    recentFailedJobs,
    jobCounts,
    avgIngest,
  ] = await Promise.all([
    prisma.document.count({ where: { workspaceId } }),
    prisma.document.count({ where: { workspaceId, status: "indexed" } }),
    prisma.document.count({ where: { workspaceId, status: "failed" } }),
    prisma.chunk.count({ where: { workspaceId } }),
    prisma.searchLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        query: true,
        mode: true,
        resultCount: true,
        createdAt: true,
      },
    }),
    prisma.question.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        question: true,
        provider: true,
        model: true,
        answer: true,
        createdAt: true,
      },
    }),
    prisma.ingestJob.findMany({
      where: { state: "failed", document: { workspaceId } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        bullJobId: true,
        attempts: true,
        durationMs: true,
        error: true,
        updatedAt: true,
        document: { select: { id: true, filename: true, status: true } },
      },
    }),
    prisma.ingestJob.groupBy({
      by: ["state"],
      where: { document: { workspaceId } },
      _count: { state: true },
    }),
    prisma.document.aggregate({
      where: { workspaceId, ingestDurationMs: { not: null } },
      _avg: { ingestDurationMs: true },
    }),
  ]);

  return {
    documents: { total: docCount, indexed, failed },
    chunks: chunkCount,
    jobs: Object.fromEntries(jobCounts.map((j) => [j.state, j._count.state])),
    avgIngestMs: Math.round(avgIngest._avg.ingestDurationMs ?? 0),
    recentFailedJobs,
    recentSearches,
    recentQuestions: recentQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      provider: q.provider,
      model: q.model,
      answerLength: q.answer.length,
      createdAt: q.createdAt,
    })),
  };
}

export type WorkspaceStats = Awaited<ReturnType<typeof getWorkspaceStats>>;
