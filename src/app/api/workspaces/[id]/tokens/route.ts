import { z } from "zod";
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import {
  API_TOKEN_SCOPES,
  DEFAULT_API_TOKEN_SCOPES,
  issueApiToken,
  normaliseScopes,
} from "@/lib/api-tokens";
import { requireScope, requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { prisma } from "@/lib/db";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(API_TOKEN_SCOPES)).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const TOKEN_CREATE_ATTEMPTS = 5;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const tokens = await prisma.apiToken.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      include: { createdByUser: { select: { email: true, name: true } } },
    });
    return {
      tokens: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        prefix: token.prefix,
        scopes: normaliseScopes(token.scopes),
        createdBy: token.createdByUser,
        lastUsedAt: token.lastUsedAt,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
        createdAt: token.createdAt,
      })),
      availableScopes: API_TOKEN_SCOPES,
      defaultScopes: DEFAULT_API_TOKEN_SCOPES,
    };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const ctx = await requireWorkspaceRole(id, "admin");
    requireScope(ctx, "admin");
    const body = createSchema.parse(await req.json());
    const scopes = body.scopes?.length ? normaliseScopes(body.scopes) : DEFAULT_API_TOKEN_SCOPES;
    if (scopes.length === 0) throw new ApiError(400, "Select at least one scope");
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new ApiError(400, "Expiration must be in the future");

    const issued = await createUniqueToken(id, ctx.user.id, body.name, scopes, expiresAt);
    await audit("auth_token_issue", {
      workspaceId: id,
      actorId: ctx.user.id,
      targetType: "api_token",
      targetId: issued.tokenRow.id,
      metadata: { action: "token_issue", name: issued.tokenRow.name, prefix: issued.tokenRow.prefix, scopes },
      request: req,
    });

    return {
      token: {
        id: issued.tokenRow.id,
        name: issued.tokenRow.name,
        prefix: issued.tokenRow.prefix,
        scopes,
        expiresAt: issued.tokenRow.expiresAt,
        createdAt: issued.tokenRow.createdAt,
      },
      secret: issued.fullToken,
    };
  });
}

async function createUniqueToken(
  workspaceId: string,
  createdByUserId: string,
  name: string,
  scopes: string[],
  expiresAt: Date | null,
) {
  for (let attempt = 0; attempt < TOKEN_CREATE_ATTEMPTS; attempt++) {
    const issued = issueApiToken();
    try {
      const tokenRow = await prisma.apiToken.create({
        data: {
          workspaceId,
          createdByUserId,
          name,
          prefix: issued.prefix,
          hashedSecret: issued.hashedSecret,
          scopes,
          expiresAt,
        },
      });
      return { tokenRow, fullToken: issued.token };
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  throw new ApiError(409, "Could not allocate a unique token prefix; please retry");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
