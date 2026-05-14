import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { audit } from "@/lib/audit";

const patchSchema = z.object({ name: z.string().min(1).max(64) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const { user } = ctx;
    const body = patchSchema.parse(await req.json());
    const before = await prisma.workspace.findUnique({
      where: { id },
      select: { name: true, slug: true },
    });
    const workspace = await prisma.workspace.update({
      where: { id },
      data: { name: body.name },
    });
    await audit("workspace_rename", {
      workspaceId: id,
      actorId: user.id,
      targetType: "workspace",
      targetId: id,
      metadata: { oldName: before?.name, newName: workspace.name, slug: workspace.slug },
      request: req,
    });
    return { workspace };
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "owner");
    requireScope(ctx, "admin");
    const { user } = ctx;
    // Prevent the user from deleting their last workspace — they would land on /app with nothing.
    const count = await prisma.membership.count({ where: { userId: user.id } });
    if (count <= 1) throw new ApiError(400, "Cannot delete your last workspace");
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { name: true, slug: true },
    });
    await audit("workspace_delete", {
      workspaceId: id,
      actorId: user.id,
      targetType: "workspace",
      targetId: id,
      metadata: { name: workspace?.name, slug: workspace?.slug },
      request: req,
    });
    await prisma.workspace.delete({ where: { id } });
    // Switch to next available membership.
    const next = await prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { currentWorkspaceId: next?.workspaceId ?? null },
    });
    return { ok: true, currentWorkspaceId: next?.workspaceId ?? null };
  });
}
