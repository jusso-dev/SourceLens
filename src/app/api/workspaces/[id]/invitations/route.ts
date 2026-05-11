import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireWorkspaceRole } from "@/lib/auth/server";
import { ApiError, withApi } from "@/lib/api";
import { inviteTemplate, sendEmail } from "@/lib/email";

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
    const { user, workspace } = await requireWorkspaceRole(id, "admin");
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
      const url = acceptUrl(existing.token);
      await sendInvite(body.email, workspace.name, user, body.role, url, existing.expiresAt);
      return { invitation: existing, reused: true, acceptUrl: url };
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

    const url = acceptUrl(token);
    await sendInvite(body.email, workspace.name, user, body.role, url, expiresAt);
    return { invitation, acceptUrl: url };
  });
}

function acceptUrl(token: string): string {
  return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${token}`;
}

async function sendInvite(
  to: string,
  workspaceName: string,
  inviter: { name?: string | null; email: string },
  role: string,
  url: string,
  expiresAt: Date,
) {
  await sendEmail(
    inviteTemplate({
      to,
      workspaceName,
      inviterName: inviter.name ?? inviter.email,
      role,
      acceptUrl: url,
      expiresAt,
    }),
  );
}
