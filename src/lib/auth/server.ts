import { headers } from "next/headers";
import { Prisma, type Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { parseApiToken, tokenScopes, verifyApiTokenSecret, type ApiTokenScope } from "@/lib/api-tokens";
import { prisma } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { roleAtLeast } from "@/lib/rbac";

type MembershipWithWorkspace = Prisma.MembershipGetPayload<{ include: { workspace: true } }>;
export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export type AuthKind =
  | { type: "session" }
  | { type: "token"; tokenId: string; scopes: ApiTokenScope[] };

export interface WorkspaceAuthContext {
  user: AuthUser;
  workspace: MembershipWithWorkspace["workspace"];
  role: Role;
  auth: AuthKind;
}

export { ForbiddenError, UnauthorizedError };

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const bearer = await resolveBearerAuth();
  if (bearer) return bearer.user;
  const session = await getSession();
  if (!session?.user) throw new UnauthorizedError();
  return session.user;
}

/** Resolve the user's active workspace.
 *  Reads `User.currentWorkspaceId`; if missing or pointing at a workspace the user
 *  no longer belongs to, falls back to the earliest membership and self-heals. */
export async function requireCurrentWorkspace(): Promise<WorkspaceAuthContext> {
  const bearer = await resolveBearerAuth();
  if (bearer) return bearer;

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
  return { user, workspace: membership.workspace, role: membership.role, auth: { type: "session" } };
}

/** Resolve the active workspace and enforce a minimum role. */
export async function requireCurrentWorkspaceRole(minRole: Role): Promise<WorkspaceAuthContext> {
  const ctx = await requireCurrentWorkspace();
  if (!roleAtLeast(ctx.role, minRole)) {
    throw new ForbiddenError(`Requires role ≥ ${minRole}`);
  }
  return ctx;
}

export async function requireWorkspaceAccess(workspaceId: string): Promise<WorkspaceAuthContext> {
  const bearer = await resolveBearerAuth();
  if (bearer) {
    if (bearer.workspace.id !== workspaceId) throw new ForbiddenError("Workspace access denied");
    return bearer;
  }

  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    include: { workspace: true },
  });
  if (!membership) throw new ForbiddenError("Workspace access denied");
  return { user, workspace: membership.workspace, role: membership.role, auth: { type: "session" } };
}

/** Like requireWorkspaceAccess but additionally enforces a minimum role. */
export async function requireWorkspaceRole(
  workspaceId: string,
  minRole: Role,
): Promise<WorkspaceAuthContext> {
  const ctx = await requireWorkspaceAccess(workspaceId);
  if (!roleAtLeast(ctx.role, minRole)) {
    throw new ForbiddenError(`Requires role ≥ ${minRole}`);
  }
  return ctx;
}

export function requireScope(ctx: Pick<WorkspaceAuthContext, "auth">, scope: ApiTokenScope): void {
  if (ctx.auth.type === "session") return;
  if (ctx.auth.scopes.includes("admin") || ctx.auth.scopes.includes(scope)) return;
  throw new ForbiddenError(`Requires token scope ${scope}`);
}

export function authRateLimitKey(ctx: Pick<WorkspaceAuthContext, "auth" | "user">): string {
  return ctx.auth.type === "token" ? `token:${ctx.auth.tokenId}` : ctx.user.id;
}

async function resolveBearerAuth(): Promise<WorkspaceAuthContext | null> {
  const headerList = await headers();
  const authorization = headerList.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  const parsed = parseApiToken(authorization.slice("Bearer ".length).trim());
  if (!parsed) throw new UnauthorizedError("Invalid bearer token");

  const token = await prisma.apiToken.findUnique({
    where: { prefix: parsed.prefix },
    include: {
      workspace: true,
      createdByUser: true,
    },
  });
  if (!token || token.revokedAt) throw new UnauthorizedError("Invalid bearer token");
  if (token.expiresAt && token.expiresAt <= new Date()) throw new UnauthorizedError("Bearer token expired");
  if (!verifyApiTokenSecret(parsed.secret, token.hashedSecret)) {
    throw new UnauthorizedError("Invalid bearer token");
  }

  const membership = await prisma.membership.findUnique({
    where: {
      userId_workspaceId: {
        userId: token.createdByUserId,
        workspaceId: token.workspaceId,
      },
    },
  });
  if (!membership) throw new ForbiddenError("Token creator no longer has workspace access");

  await prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error("[auth] failed to record token lastUsedAt:", err));

  return {
    user: token.createdByUser,
    workspace: token.workspace,
    role: membership.role,
    auth: { type: "token", tokenId: token.id, scopes: tokenScopes(token) },
  };
}
