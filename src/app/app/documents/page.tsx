"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [workspaceName, setWorkspaceName] = useState("this workspace");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setDocs(data.documents);
      if (data.workspace?.name) setWorkspaceName(data.workspace.name);
      setSelected((current) => new Set([...current].filter((id) => data.documents.some((doc: Doc) => doc.id === id))));
    }
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

  const selectedDocs = useMemo(() => docs.filter((doc) => selected.has(doc.id)), [docs, selected]);
  const allVisibleSelected = docs.length > 0 && docs.every((doc) => selected.has(doc.id));
  const selectedChunkCount = selectedDocs.reduce((sum, doc) => sum + doc._count.chunks, 0);

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        docs.forEach((doc) => next.delete(doc.id));
      } else {
        docs.forEach((doc) => next.add(doc.id));
      }
      return next;
    });
  }

  function toggleDoc(id: string, shiftKey: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (shiftKey && lastSelected) {
        const start = docs.findIndex((doc) => doc.id === lastSelected);
        const end = docs.findIndex((doc) => doc.id === id);
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          docs.slice(from, to + 1).forEach((doc) => next.add(doc.id));
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastSelected(id);
  }

  async function bulk(action: "delete" | "retry") {
    if (selectedDocs.length === 0) return;
    if (action === "delete") {
      const ok = confirm(
        `Delete ${selectedDocs.length} documents from "${workspaceName}"? This will remove ${selectedChunkCount} chunks.`,
      );
      if (!ok) return;
    }
    const res = await fetch("/api/documents/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedDocs.map((doc) => doc.id), action }),
    });
    if (res.ok) setSelected(new Set());
    refresh();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && docs.length > 0) {
        event.preventDefault();
        setSelected(new Set(docs.map((doc) => doc.id)));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [docs]);

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
        <div className="space-y-3">
          {selectedDocs.length > 0 && (
            <div className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="text-sm">
                <span className="font-medium">{selectedDocs.length}</span> selected
                <span className="ml-2 text-zinc-500">{selectedChunkCount} chunks</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="danger" onClick={() => bulk("delete")}>Delete</Button>
                <Button size="sm" variant="secondary" onClick={() => bulk("retry")}>Retry ingest</Button>
                <Button size="sm" variant="ghost" disabled>Move to folder</Button>
                <Button size="sm" variant="ghost" disabled>Add tags</Button>
              </div>
            </div>
          )}
          <div className="sl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Select all visible documents"
                  />
                </th>
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
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      readOnly
                      onClick={(event) => toggleDoc(d.id, event.shiftKey)}
                      aria-label={`Select ${d.filename}`}
                    />
                  </td>
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
