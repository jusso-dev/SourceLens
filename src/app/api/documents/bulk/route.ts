import { z } from "zod";
import { audit } from "@/lib/audit";
import { ApiError, withApi } from "@/lib/api";
import { authRateLimitKey, requireCurrentWorkspace, requireScope } from "@/lib/auth/server";
import { runBulk } from "@/lib/bulk";
import { prisma } from "@/lib/db";
import { enqueueIngest } from "@/lib/queue";
import { enforceRateLimitCost } from "@/lib/ratelimit";
import { deleteUpload } from "@/lib/storage";
import { emitWebhookEvent } from "@/lib/webhooks/events";

const schema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(["delete", "retry", "move", "tag"]),
  payload: z.unknown().optional(),
});

type BulkBody = z.infer<typeof schema>;
type BulkDoc = Awaited<ReturnType<typeof findBulkDocuments>>[number];

export async function POST(req: Request) {
  const stream = new URL(req.url).searchParams.get("stream") === "1";
  return stream ? streamBulk(req) : jsonBulk(req);
}

async function jsonBulk(req: Request) {
  return withApi(async () => executeBulk(req, undefined));
}

async function streamBulk(req: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const result = await executeBulk(req, (progress) => send("progress", progress));
        send("done", result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Bulk operation failed";
        send("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function executeBulk(
  req: Request,
  onProgress: ((progress: unknown) => void) | undefined,
) {
  const ctx = await requireCurrentWorkspace();
  requireScope(ctx, "documents:write");
  const { workspace, user } = ctx;
  const body = schema.parse(await req.json());
  if (body.action === "move" || body.action === "tag") {
    throw new ApiError(400, `${body.action} depends on tags/folders and is not available yet`);
  }
  await enforceRateLimitCost("retry", authRateLimitKey(ctx), body.ids.length);

  const docs = await findBulkDocuments(workspace.id, body);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const ordered = body.ids.map((id) => byId.get(id)).filter((doc): doc is BulkDoc => Boolean(doc));
  if (ordered.length !== body.ids.length) throw new ApiError(404, "One or more documents were not found");

  const result = await runBulk(
    ordered,
    async (doc) => {
      if (body.action === "delete") {
        await deleteUpload(doc.storagePath).catch(() => undefined);
        await prisma.document.delete({ where: { id: doc.id } });
        await emitWebhookEvent({
          workspaceId: workspace.id,
          type: "document.deleted",
          actorId: user.id,
          subjectId: doc.id,
          data: { document: { id: doc.id, filename: doc.filename }, chunkCount: doc._count.chunks, bulk: true },
        });
        return;
      }

      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "uploaded", error: null },
      });
      const jobId = await enqueueIngest(doc.id);
      await audit("document_retry", {
        workspaceId: workspace.id,
        actorId: user.id,
        targetType: "document",
        targetId: doc.id,
        metadata: { filename: doc.filename, jobId, bulk: true },
        request: req,
      });
    },
    onProgress,
  );

  if (body.action === "delete") {
    await audit("document_delete", {
      workspaceId: workspace.id,
      actorId: user.id,
      targetType: "document",
      targetId: null,
      metadata: {
        bulk: true,
        count: ordered.length,
        chunkCount: ordered.reduce((sum, doc) => sum + doc._count.chunks, 0),
        filenames: ordered.map((doc) => doc.filename).slice(0, 20),
      },
      request: req,
    });
  }

  return { ok: result.failed === 0, action: body.action, ...result };
}

function findBulkDocuments(workspaceId: string, body: BulkBody) {
  return prisma.document.findMany({
    where: { workspaceId, id: { in: body.ids } },
    include: { _count: { select: { chunks: true } } },
  });
}
