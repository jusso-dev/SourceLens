import { prisma } from "@/lib/db";
import { WEBHOOK_DISABLE_AFTER_FAILURES } from "@/lib/webhooks/config";
import { signWebhookPayload } from "@/lib/webhooks/signing";

export async function deliverWebhook(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery) throw new Error(`Webhook delivery ${deliveryId} not found`);
  if (!delivery.webhook.active) throw new Error(`Webhook ${delivery.webhookId} is disabled`);

  const body = JSON.stringify(delivery.payload);
  const attempts = delivery.attempts + 1;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: { attempts, status: "sending", error: null },
  });

  try {
    const res = await fetch(delivery.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "SourceLens-Webhooks/1.0",
        "x-sourcelens-signature": signWebhookPayload(delivery.webhook.secret, body),
      },
      body,
    });
    const responseBody = await res.text().catch(() => "");
    if (!res.ok) {
      throw new WebhookHttpError(res.status, responseBody);
    }
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "delivered",
          responseStatus: res.status,
          responseBody: responseBody.slice(0, 2000),
          deliveredAt: new Date(),
          error: null,
        },
      }),
      prisma.webhook.update({
        where: { id: delivery.webhookId },
        data: { lastDeliveredAt: new Date(), failureCount: 0 },
      }),
    ]);
  } catch (err) {
    const status = err instanceof WebhookHttpError ? err.status : null;
    const message = err instanceof Error ? err.message : String(err);
    const failureCount = delivery.webhook.failureCount + 1;
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          responseStatus: status,
          responseBody: err instanceof WebhookHttpError ? err.body.slice(0, 2000) : null,
          error: message.slice(0, 2000),
        },
      }),
      prisma.webhook.update({
        where: { id: delivery.webhookId },
        data: {
          failureCount,
          active: failureCount >= WEBHOOK_DISABLE_AFTER_FAILURES ? false : delivery.webhook.active,
        },
      }),
    ]);
    throw err;
  }
}

class WebhookHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Webhook endpoint returned HTTP ${status}`);
  }
}
