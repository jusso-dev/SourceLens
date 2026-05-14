import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enqueueWebhookDelivery } from "@/lib/queue";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; deliveryId: string }> },
) {
  const { id, deliveryId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.workspaceId !== id) throw new ApiError(404, "Delivery not found");
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "pending", error: null, responseStatus: null, responseBody: null },
    });
    const jobId = await enqueueWebhookDelivery(deliveryId);
    return { ok: true, jobId };
  });
}
