import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getClientIp } from "@/lib/ratelimit";

export interface AuditContext {
  workspaceId?: string | null;
  actorId?: string | null;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  request?: Request;
}

export function requestAuditFields(request: Request | undefined) {
  if (!request) return { ip: null, userAgent: null };
  return {
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function audit(action: AuditAction, ctx: AuditContext): Promise<void> {
  const { ip, userAgent } = requestAuditFields(ctx.request);
  try {
    await prisma.auditLog.create({
      data: {
        workspaceId: ctx.workspaceId ?? null,
        actorId: ctx.actorId ?? null,
        action,
        targetType: ctx.targetType,
        targetId: ctx.targetId ?? null,
        metadata: ctx.metadata ?? {},
        ip,
        userAgent,
      },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err);
  }
}

export async function pruneAuditLogs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.auditRetentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
