import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";

const patchSchema = z.object({ name: z.string().min(1).max(64) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    await requireWorkspaceRole(id, "admin");
    const body = patchSchema.parse(await req.json());
    const workspace = await prisma.workspace.update({
      where: { id },
      data: { name: body.name },
    });
    return { workspace };
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { user } = await requireWorkspaceRole(id, "owner");
    // Prevent the user from deleting their last workspace — they would land on /app with nothing.
    const count = await prisma.membership.count({ where: { userId: user.id } });
    if (count <= 1) throw new ApiError(400, "Cannot delete your last workspace");
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
