import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { WEBHOOK_EVENT_TYPES, normaliseEventTypes } from "@/lib/webhooks/events";

const patchSchema = z.object({
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "Must be HTTP(S)").optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; webhookId: string }> },
) {
  const { id, webhookId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const body = patchSchema.parse(await req.json());
    const existing = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!existing || existing.workspaceId !== id) throw new ApiError(404, "Webhook not found");
    const webhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        url: body.url,
        eventTypes: body.eventTypes,
        active: body.active,
        failureCount: body.active === true ? 0 : undefined,
      },
    });
    await audit("webhook_update", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "webhook",
      targetId: webhook.id,
      metadata: { url: webhook.url, eventTypes: normaliseEventTypes(webhook.eventTypes), active: webhook.active },
      request: req,
    });
    return { webhook: { ...webhook, eventTypes: normaliseEventTypes(webhook.eventTypes) } };
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; webhookId: string }> },
) {
  const { id, webhookId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const existing = await prisma.webhook.findUnique({ where: { id: webhookId } });
    if (!existing || existing.workspaceId !== id) throw new ApiError(404, "Webhook not found");
    await prisma.webhook.delete({ where: { id: webhookId } });
    await audit("webhook_delete", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "webhook",
      targetId: webhookId,
      metadata: { url: existing.url },
      request: req,
    });
    return { ok: true };
  });
}
