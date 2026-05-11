"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, StatusBadge } from "@/components/ui";

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

  const refresh = useCallback(async () => {
    const res = await fetch("/api/jobs", { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setJobs(data.jobs);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Background jobs</h1>
        <p className="text-sm text-zinc-500">BullMQ ingestion jobs for this workspace, refreshed every 3 s.</p>
      </div>

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
                  <td className="px-4 py-3 font-mono text-xs">{j.bullJobId}</td>
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
