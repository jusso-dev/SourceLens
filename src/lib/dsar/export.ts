import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/lib/storage";

const EXPORT_TTL_DAYS = 7;

export async function runDsarExport(exportId: string, userId: string): Promise<void> {
  await prisma.dataExport.update({
    where: { id: exportId },
    data: { status: "processing", error: null },
  });

  try {
    const bundle = await collectUserData(userId);
    const zip = new JSZip();
    zip.file("profile.json", JSON.stringify(bundle.profile, null, 2));
    zip.file("memberships.json", JSON.stringify(bundle.memberships, null, 2));
    zip.file("documents.json", JSON.stringify(bundle.documents, null, 2));
    zip.file("questions.jsonl", jsonl(bundle.questions));
    zip.file("searches.jsonl", jsonl(bundle.searches));
    zip.file("audit.jsonl", jsonl(bundle.audit));
    zip.file("invitations.jsonl", jsonl(bundle.invitations));

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const filename = `user-${userId}-${Date.now()}.zip`;
    const stored = await saveUpload(`privacy-${userId}`, filename, buffer, {
      sizeBytes: buffer.byteLength,
      contentType: "application/zip",
    });
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        filename,
        storagePath: stored.storagePath,
        status: "completed",
        completedAt: new Date(),
      },
    });
  } catch (err) {
    await prisma.dataExport.update({
      where: { id: exportId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
      },
    });
    throw err;
  }
}

export function exportExpiry(now = new Date()): Date {
  return new Date(now.getTime() + EXPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function collectUserData(userId: string) {
  const [
    user,
    sessions,
    accounts,
    memberships,
    documents,
    questions,
    searches,
    audit,
    invitations,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.session.findMany({
      where: { userId },
      select: { id: true, expiresAt: true, ipAddress: true, userAgent: true, createdAt: true, updatedAt: true },
    }),
    prisma.account.findMany({
      where: { userId },
      select: { id: true, providerId: true, accountId: true, createdAt: true, updatedAt: true },
    }),
    prisma.membership.findMany({
      where: { userId },
      include: { workspace: { select: { id: true, name: true, slug: true, ownerId: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.document.findMany({
      where: { uploadedById: userId },
      select: {
        id: true,
        workspaceId: true,
        filename: true,
        mimeType: true,
        fileType: true,
        sizeBytes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.question.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.searchLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.findMany({ where: { actorId: userId }, orderBy: { createdAt: "desc" } }),
    prisma.invitation.findMany({ where: { invitedById: userId }, orderBy: { createdAt: "desc" } }),
  ]);

  return {
    profile: { user, sessions, accounts },
    memberships: memberships.map((membership) => ({
      workspace: membership.workspace,
      role: membership.role,
      joinedAt: membership.createdAt,
    })),
    documents,
    questions,
    searches,
    audit,
    invitations,
  };
}

function jsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n");
}
