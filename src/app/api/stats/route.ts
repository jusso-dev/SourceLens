import { requireCurrentWorkspaceRole, requireScope } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { getWorkspaceStats } from "@/lib/stats";

export async function GET() {
  return withApi(async () => {
    const ctx = await requireCurrentWorkspaceRole("admin");
    requireScope(ctx, "admin");
    const { workspace } = ctx;
    const stats = await getWorkspaceStats(workspace.id);
    return {
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      ...stats,
    };
  });
}
