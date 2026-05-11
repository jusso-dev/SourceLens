import Link from "next/link";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { prisma } from "@/lib/db";
import { Badge, Button, Card, EmptyState, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { workspace } = await requireCurrentWorkspace();

  const [docCount, indexed, failed, chunkCount, recentDocs, recentQs] = await Promise.all([
    prisma.document.count({ where: { workspaceId: workspace.id } }),
    prisma.document.count({ where: { workspaceId: workspace.id, status: "indexed" } }),
    prisma.document.count({ where: { workspaceId: workspace.id, status: "failed" } }),
    prisma.chunk.count({ where: { workspaceId: workspace.id } }),
    prisma.document.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.question.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const stats = [
    { label: "Documents", value: docCount },
    { label: "Indexed", value: indexed },
    { label: "Failed", value: failed, tone: failed > 0 ? "red" : undefined },
    { label: "Chunks", value: chunkCount },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <p className="text-sm text-zinc-500">/{workspace.slug}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/documents"><Button variant="secondary" size="sm">Documents</Button></Link>
          <Link href="/app/ask"><Button size="sm">Ask a question</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <div className="text-xs text-zinc-500">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold">{s.value}</div>
          </Card>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent documents</h2>
          <Link href="/app/documents" className="text-sm text-indigo-600 hover:underline">View all</Link>
        </div>
        {recentDocs.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Upload your first PDF, Markdown, or text file to start indexing."
            action={<Link href="/app/documents"><Button>Upload document</Button></Link>}
          />
        ) : (
          <div className="sl-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr><th className="px-4 py-3">Filename</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th></tr>
              </thead>
              <tbody>
                {recentDocs.map((d) => (
                  <tr key={d.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <td className="px-4 py-3 font-medium truncate max-w-xs">{d.filename}</td>
                    <td className="px-4 py-3"><Badge tone="violet">{d.fileType}</Badge></td>
                    <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-3 text-zinc-500">{d.createdAt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent questions</h2>
          <Link href="/app/ask" className="text-sm text-indigo-600 hover:underline">Ask another</Link>
        </div>
        {recentQs.length === 0 ? (
          <EmptyState title="No questions yet" description="Once documents are indexed, ask anything across your workspace." />
        ) : (
          <div className="space-y-3">
            {recentQs.map((q) => (
              <Card key={q.id}>
                <div className="text-xs text-zinc-500">
                  {q.createdAt.toLocaleString()} · <Badge tone="blue">{q.provider}</Badge>
                </div>
                <div className="mt-1 font-medium">{q.question}</div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3 whitespace-pre-wrap">
                  {q.answer}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
