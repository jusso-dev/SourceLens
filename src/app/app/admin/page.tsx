import { requireCurrentWorkspaceRole } from "@/lib/auth/server";
import { getWorkspaceStats } from "@/lib/stats";
import { AdminDashboardClient, type AdminDashboardData } from "./AdminDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { workspace } = await requireCurrentWorkspaceRole("admin");
  const stats = await getWorkspaceStats(workspace.id);
  const initialData = JSON.parse(
    JSON.stringify({
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
      ...stats,
    }),
  ) as AdminDashboardData;

  return <AdminDashboardClient initialData={initialData} />;
}
