import { audit } from "@/lib/audit";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enqueueWebhookDelivery } from "@/lib/queue";
import { buildWebhookPayload } from "@/lib/webhooks/events";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; webhookId: string }> },
) {
  const { id, webhookId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const webhook = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!webhook || webhook.workspaceId !== id) throw new ApiError(404, "Webhook not found");
    const delivery = await prisma.webhookDelivery.create({
      data: {
        workspaceId: id,
        webhookId,
        eventType: "document.uploaded",
        payload: buildWebhookPayload({
          workspaceId: id,
          type: "document.uploaded",
          actorId: ctx.user.id,
          subjectId: "sample",
          data: { sample: true, document: { id: "sample", filename: "sample.txt" } },
        }),
      },
    });
    const jobId = await enqueueWebhookDelivery(delivery.id);
    await audit("webhook_test", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "webhook",
      targetId: webhookId,
      metadata: { deliveryId: delivery.id, jobId },
      request: req,
    });
    return { ok: true, deliveryId: delivery.id, jobId };
  });
}
