"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Spinner, StatusBadge } from "@/components/ui";
import { UploadDropzone } from "@/components/UploadDropzone";

interface Doc {
  id: string;
  filename: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  ingestDurationMs: number | null;
  createdAt: string;
  _count: { chunks: number };
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setDocs(data.documents);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const t = setInterval(refresh, 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [refresh]);

  async function retryDoc(id: string) {
    await fetch(`/api/documents/${id}/retry`, { method: "POST" });
    refresh();
  }

  async function deleteDoc(id: string) {
    if (!confirm("Delete this document and its chunks?")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-sm text-zinc-500">Upload PDFs, Markdown, or text files to index them.</p>
        </div>
      </div>

      <UploadDropzone onUploaded={refresh} />

      {loading ? (
        <Card><Spinner /> Loading…</Card>
      ) : docs.length === 0 ? (
        <EmptyState title="No documents yet" description="Upload your first file to start indexing." />
      ) : (
        <div className="sl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3">Filename</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Chunks</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <td className="px-4 py-3 font-medium truncate max-w-xs">
                    <div>{d.filename}</div>
                    {d.error && <div className="text-xs text-red-600 mt-1 truncate">{d.error}</div>}
                  </td>
                  <td className="px-4 py-3">{d.fileType}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                  <td className="px-4 py-3">{d._count.chunks}</td>
                  <td className="px-4 py-3">{formatSize(d.sizeBytes)}</td>
                  <td className="px-4 py-3 text-zinc-500">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-2">
                      {d.status === "failed" && (
                        <Button size="sm" variant="secondary" onClick={() => retryDoc(d.id)}>Retry</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => deleteDoc(d.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
