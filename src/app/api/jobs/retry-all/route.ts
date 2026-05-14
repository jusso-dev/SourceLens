import { Job } from "bullmq";
import { prisma } from "@/lib/db";
import { requireCurrentWorkspaceRole } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { getIngestQueue, type IngestJobData } from "@/lib/queue";
import { enforceRateLimit } from "@/lib/ratelimit";

export async function POST() {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspaceRole("admin");
    await enforceRateLimit("retry", user.id);

    const queue = getIngestQueue();
    const failedJobs = await queue.getJobs(["failed"], 0, -1, false);
    const documentIds = failedJobs.map((job) => job.data.documentId);
    const workspaceDocs = await prisma.document.findMany({
      where: { id: { in: documentIds }, workspaceId: workspace.id },
      select: { id: true },
    });
    const allowed = new Set(workspaceDocs.map((doc) => doc.id));
    const retried: string[] = [];

    for (const job of failedJobs) {
      if (!allowed.has(job.data.documentId)) continue;
      await retryFailedJob(job);
      if (job.id) retried.push(String(job.id));
    }

    if (retried.length > 0) {
      await prisma.ingestJob.updateMany({
        where: { bullJobId: { in: retried } },
        data: { state: "waiting", error: null, finishedAt: null },
      });
    }

    return { ok: true, retried: retried.length };
  });
}

async function retryFailedJob(job: Job<IngestJobData>) {
  try {
    await job.retry("failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("not in the failed state")) throw err;
  }
}
