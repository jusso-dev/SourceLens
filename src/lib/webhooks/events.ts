import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueWebhookDelivery } from "@/lib/queue";

export const WEBHOOK_EVENT_TYPES = [
  "document.uploaded",
  "document.indexed",
  "document.failed",
  "document.deleted",
  "question.answered",
  "membership.added",
  "membership.removed",
  "invitation.sent",
  "invitation.accepted",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookEventInput {
  workspaceId: string;
  type: WebhookEventType;
  actorId?: string | null;
  subjectId?: string | null;
  data: Prisma.InputJsonObject;
}

export function normaliseEventTypes(raw: unknown): WebhookEventType[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(WEBHOOK_EVENT_TYPES);
  return Array.from(
    new Set(raw.filter((event): event is WebhookEventType => typeof event === "string" && allowed.has(event))),
  );
}

export function buildWebhookPayload(input: WebhookEventInput): Prisma.InputJsonObject {
  return {
    id: crypto.randomUUID(),
    type: input.type,
    workspaceId: input.workspaceId,
    actorId: input.actorId ?? null,
    subjectId: input.subjectId ?? null,
    createdAt: new Date().toISOString(),
    data: {
      schema: "1",
      ...input.data,
    },
  };
}

export async function emitWebhookEvent(input: WebhookEventInput): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { workspaceId: input.workspaceId, active: true },
    });
    const payload = buildWebhookPayload(input);
    for (const webhook of webhooks) {
      const eventTypes = normaliseEventTypes(webhook.eventTypes);
      if (!eventTypes.includes(input.type)) continue;
      const delivery = await prisma.webhookDelivery.create({
        data: {
          workspaceId: input.workspaceId,
          webhookId: webhook.id,
          eventType: input.type,
          payload,
        },
      });
      await enqueueWebhookDelivery(delivery.id);
    }
  } catch (err) {
    console.error("[webhooks] failed to emit event:", err);
  }
}
