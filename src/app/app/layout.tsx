import { redirect } from "next/navigation";
import { getSession, requireCurrentWorkspace } from "@/lib/auth/server";
import { Sidebar } from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) redirect("/login?next=/app");
  const { workspace } = await requireCurrentWorkspace();
  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={{ name: session.user.name, email: session.user.email }}
        workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug }}
      />
      <main className="flex-1 flex flex-col">
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center px-6">
          <span className="text-sm text-zinc-500">SourceLens</span>
        </header>
        <div className="flex-1 p-6 max-w-6xl w-full mx-auto">{children}</div>
      </main>
    </div>
  );
}
