import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { WEBHOOK_EVENT_TYPES, normaliseEventTypes } from "@/lib/webhooks/events";

const schema = z.object({
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "Must be HTTP(S)"),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  active: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const webhooks = await prisma.webhook.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      include: {
        deliveries: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
    return {
      availableEventTypes: WEBHOOK_EVENT_TYPES,
      webhooks: webhooks.map((webhook) => ({
        id: webhook.id,
        url: webhook.url,
        eventTypes: normaliseEventTypes(webhook.eventTypes),
        active: webhook.active,
        lastDeliveredAt: webhook.lastDeliveredAt,
        failureCount: webhook.failureCount,
        createdAt: webhook.createdAt,
        deliveries: webhook.deliveries,
      })),
    };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const body = schema.parse(await req.json());
    const webhook = await prisma.webhook.create({
      data: {
        workspaceId: id,
        url: body.url,
        secret: randomBytes(32).toString("base64url"),
        eventTypes: body.eventTypes,
        active: body.active ?? true,
      },
    });
    await audit("webhook_create", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "webhook",
      targetId: webhook.id,
      metadata: { action: "webhook_create", url: webhook.url, eventTypes: body.eventTypes },
      request: req,
    });
    return {
      webhook: { ...webhook, eventTypes: normaliseEventTypes(webhook.eventTypes) },
      secret: webhook.secret,
    };
  });
}
