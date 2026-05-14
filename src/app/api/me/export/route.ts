import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { exportExpiry } from "@/lib/dsar/export";
import { enqueueDsarExport } from "@/lib/queue";

export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const filename = `user-${user.id}-${Date.now()}.zip`;
    const dataExport = await prisma.dataExport.create({
      data: {
        userId: user.id,
        filename,
        expiresAt: exportExpiry(),
      },
    });
    const jobId = await enqueueDsarExport(dataExport.id, user.id);
    await audit("dsar_export_request", {
      actorId: user.id,
      targetType: "data_export",
      targetId: dataExport.id,
      metadata: { action: "dsar_export_requested", jobId },
      request: req,
    });
    return { ok: true, exportId: dataExport.id, jobId, expiresAt: dataExport.expiresAt };
  });
}
