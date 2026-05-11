import { headers } from "next/headers";
import { Prisma, type Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { roleAtLeast } from "@/lib/rbac";

type MembershipWithWorkspace = Prisma.MembershipGetPayload<{ include: { workspace: true } }>;

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new UnauthorizedError();
  return session.user;
}

/** Resolve the user's active workspace.
 *  Reads `User.currentWorkspaceId`; if missing or pointing at a workspace the user
 *  no longer belongs to, falls back to the earliest membership and self-heals. */
export async function requireCurrentWorkspace() {
  const user = await requireUser();
  const prismaUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { currentWorkspaceId: true },
  });

  let membership: MembershipWithWorkspace | null = null;

  if (prismaUser?.currentWorkspaceId) {
    membership = await prisma.membership.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: prismaUser.currentWorkspaceId,
        },
      },
      include: { workspace: true },
    });
  }
  if (!membership) {
    membership = await prisma.membership.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });
    if (membership) {
      await prisma.user.update({
        where: { id: user.id },
        data: { currentWorkspaceId: membership.workspaceId },
      });
    }
  }
  if (!membership) throw new ForbiddenError("No workspace");
  return { user, workspace: membership.workspace, role: membership.role };
}

export async function requireWorkspaceAccess(workspaceId: string) {
  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) throw new ForbiddenError("Workspace access denied");
  return { user, workspace: membership.workspace, role: membership.role };
}

/** Like requireWorkspaceAccess but additionally enforces a minimum role. */
export async function requireWorkspaceRole(workspaceId: string, minRole: Role) {
  const ctx = await requireWorkspaceAccess(workspaceId);
  if (!roleAtLeast(ctx.role, minRole)) {
    throw new ForbiddenError(`Requires role ≥ ${minRole}`);
  }
  return ctx;
}

export class UnauthorizedError extends Error {
  status = 401 as const;
  constructor(msg = "Unauthorized") {
    super(msg);
  }
}

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(msg = "Forbidden") {
    super(msg);
  }
}
