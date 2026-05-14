import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/rbac";

const patchSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const { role: actorRole, user: actor } = ctx;
    const body = patchSchema.parse(await req.json());

    const target = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: id } },
    });
    if (!target) throw new ApiError(404, "Member not found");

    // Owners cannot be demoted by non-owners; owners are also the only ones who can grant owner.
    if (target.role === "owner" && actorRole !== "owner") {
      throw new ApiError(403, "Only an owner can change another owner's role");
    }
    if (body.role === "owner" && actorRole !== "owner") {
      throw new ApiError(403, "Only an owner can grant ownership");
    }
    // Admins cannot change roles above their own rank.
    if (!roleAtLeast(actorRole, target.role) && actor.id !== userId) {
      throw new ApiError(403, "Cannot modify a higher-ranked member");
    }

    // Ensure at least one owner remains.
    if (target.role === "owner" && body.role !== "owner") {
      const owners = await prisma.membership.count({
        where: { workspaceId: id, role: "owner" },
      });
      if (owners <= 1) throw new ApiError(400, "Workspace must have at least one owner");
    }

    const updated = await prisma.membership.update({
      where: { userId_workspaceId: { userId, workspaceId: id } },
      data: { role: body.role as Role },
    });
    await audit(
      body.role === "owner" ? "workspace_transfer_ownership" : "membership_role_change",
      {
        workspaceId: id,
        actorId: actor.id,
        targetType: "membership",
        targetId: updated.id,
        metadata: { userId, oldRole: target.role, newRole: updated.role },
        request: req,
      },
    );
    return { membership: updated };
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const { user: actor, role: actorRole } = ctx;

    const target = await prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: id } },
    });
    if (!target) throw new ApiError(404, "Member not found");

    if (target.role === "owner") {
      const owners = await prisma.membership.count({
        where: { workspaceId: id, role: "owner" },
      });
      if (owners <= 1) throw new ApiError(400, "Cannot remove the last owner");
      if (actorRole !== "owner") throw new ApiError(403, "Only owners can remove owners");
    }
    if (actor.id === userId && target.role === "owner") {
      // Owner leaving their own workspace: allowed only when another owner exists (checked above).
    }

    await prisma.membership.delete({
      where: { userId_workspaceId: { userId, workspaceId: id } },
    });
    await audit("membership_remove", {
      workspaceId: id,
      actorId: actor.id,
      targetType: "membership",
      targetId: target.id,
      metadata: { userId, role: target.role },
      request: req,
    });

    // If the removed user had this workspace as current, clear it.
    await prisma.user.updateMany({
      where: { id: userId, currentWorkspaceId: id },
      data: { currentWorkspaceId: null },
    });

    return { ok: true };
  });
}
