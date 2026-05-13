import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { slugify } from "@/lib/slug";

const createSchema = z.object({ name: z.string().min(1).max(64) });

/** Max attempts to find an unused slug suffix before we give up. With 6 hex
 *  characters that's 16,777,216 possibilities, so collisions inside this many
 *  retries are astronomically unlikely outside an actively malicious workload. */
const SLUG_MAX_ATTEMPTS = 5;

export async function GET() {
  return withApi(async () => {
    const user = await requireUser();
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: {
        workspace: { select: { id: true, name: true, slug: true, createdAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: { currentWorkspaceId: true },
    });
    return {
      currentWorkspaceId: u?.currentWorkspaceId ?? null,
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const body = createSchema.parse(await req.json());
    const baseSlug = slugify(body.name);

    let lastError: unknown = null;
    for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt++) {
      const slug = `${baseSlug}-${randomSuffix(6)}`;
      try {
        const workspace = await prisma.workspace.create({
          data: {
            name: body.name,
            slug,
            ownerId: user.id,
            memberships: { create: { userId: user.id, role: "owner" } },
          },
        });
        await prisma.user.update({
          where: { id: user.id },
          data: { currentWorkspaceId: workspace.id },
        });
        return { workspace };
      } catch (err) {
        if (isUniqueViolation(err, "slug")) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    console.error("[workspaces] exhausted slug retries", lastError);
    throw new ApiError(409, "Could not allocate a unique workspace slug; please retry");
  });
}

function randomSuffix(byteCount: number): string {
  // Hex output is 2 × byteCount characters, all `[0-9a-f]` — safe in URLs and
  // matches the look of the existing slugs.
  return randomBytes(byteCount).toString("hex").slice(0, byteCount);
}

function isUniqueViolation(err: unknown, fieldHint?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  if (!fieldHint) return true;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes(fieldHint);
  if (typeof target === "string") return target.includes(fieldHint);
  return true;
}
