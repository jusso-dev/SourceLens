import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { slugify } from "@/lib/slug";

const createSchema = z.object({ name: z.string().min(1).max(64) });

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
    const slug = `${baseSlug}-${randomSlug(6)}`;
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
  });
}

function randomSlug(n: number): string {
  return Math.random().toString(36).slice(2, 2 + n);
}
