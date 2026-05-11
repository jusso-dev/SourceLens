import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";

const createSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

const INVITE_TTL_DAYS = 7;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    await requireWorkspaceRole(id, "admin");
    const invitations = await prisma.invitation.findMany({
      where: { workspaceId: id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      include: { invitedBy: { select: { name: true, email: true } } },
    });
    return { invitations };
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withApi(async () => {
    const { user } = await requireWorkspaceRole(id, "admin");
    const body = createSchema.parse(await req.json());

    // Already a member?
    const existingUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser) {
      const existing = await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId: id } },
      });
      if (existing) throw new ApiError(409, `${body.email} is already a member`);
    }

    // Re-use a pending invite for the same email/workspace.
    const existing = await prisma.invitation.findFirst({
      where: { workspaceId: id, email: body.email, acceptedAt: null, revokedAt: null },
    });
    if (existing && existing.expiresAt > new Date()) {
      return { invitation: existing, reused: true };
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000);
    const invitation = await prisma.invitation.create({
      data: {
        workspaceId: id,
        email: body.email,
        role: body.role,
        token,
        invitedById: user.id,
        expiresAt,
      },
    });

    // Real email delivery is a separate issue; log the accept URL so devs can copy it.
    const url = `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${token}`;
    console.log(`[invitations] accept URL for ${body.email} → ${url}`);

    return { invitation, acceptUrl: url };
  });
}
