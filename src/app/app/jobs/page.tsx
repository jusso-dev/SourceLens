"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Spinner, StatusBadge } from "@/components/ui";

interface JobRow {
  id: string;
  bullJobId: string;
  state: string;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  document: { id: string; filename: string; status: string };
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingAll, setRetryingAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setJobs(data.jobs);
    setLoading(false);
  }, []);

  async function retryAllFailed() {
    setRetryingAll(true);
    setMessage(null);
    const res = await fetch("/api/jobs/retry-all", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setRetryingAll(false);
    if (!res.ok) {
      setMessage(body.error ?? `Retry failed (${res.status})`);
      return;
    }
    setMessage(`Retried ${body.retried} failed job${body.retried === 1 ? "" : "s"}.`);
    refresh();
  }

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const t = setInterval(refresh, 3000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Background jobs</h1>
          <p className="text-sm text-zinc-500">BullMQ ingestion jobs for this workspace, refreshed every 3 s.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/internal/bull" className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800">
            Bull Board
          </Link>
          <Button size="sm" variant="secondary" onClick={retryAllFailed} disabled={retryingAll}>
            {retryingAll ? <><Spinner /> Retrying</> : "Retry all failed"}
          </Button>
        </div>
      </div>

      {message && (
        <div className="sl-card p-4 text-sm text-zinc-700 dark:text-zinc-300">{message}</div>
      )}

      {loading ? (
        <Card><Spinner /> Loading…</Card>
      ) : jobs.length === 0 ? (
        <EmptyState title="No jobs" description="Upload a document to see ingestion jobs here." />
      ) : (
        <div className="sl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/internal/bull/queue/ingest/${j.bullJobId}`} className="text-indigo-600 hover:underline">
                      {j.bullJobId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 truncate max-w-xs">
                    <div>{j.document.filename}</div>
                    {j.error && <div className="text-xs text-red-600 mt-1 truncate">{j.error}</div>}
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={j.state} /></td>
                  <td className="px-4 py-3">{j.attempts}</td>
                  <td className="px-4 py-3">{j.durationMs ? `${j.durationMs} ms` : "—"}</td>
                  <td className="px-4 py-3 text-zinc-500">{new Date(j.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
