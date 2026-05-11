import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new UnauthorizedError();
  return session.user;
}

/** Resolve the user's "current" workspace.
 *  v1: a user has exactly one workspace (created on signup). Pick the first owned one,
 *  falling back to any membership. */
export async function requireCurrentWorkspace() {
  const user = await requireUser();
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
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
