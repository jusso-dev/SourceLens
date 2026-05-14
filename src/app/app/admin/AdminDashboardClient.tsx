"use client";

import Link from "next/link";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Spinner, cn } from "@/components/ui";

type JobState = "waiting" | "active" | "completed" | "failed" | "delayed";

interface FailedJob {
  id: string;
  bullJobId: string;
  attempts: number;
  durationMs: number | null;
  error: string | null;
  updatedAt: string;
  document: { id: string; filename: string; status: string };
}

interface RecentSearch {
  id: string;
  query: string;
  mode: string;
  resultCount: number;
  createdAt: string;
}

interface RecentQuestion {
  id: string;
  question: string;
  provider: string;
  model: string;
  answerLength: number;
  createdAt: string;
}

export interface AdminDashboardData {
  workspace: { id: string; name: string; slug: string };
  documents: { total: number; indexed: number; failed: number };
  chunks: number;
  jobs: Partial<Record<JobState, number>>;
  avgIngestMs: number;
  recentFailedJobs: FailedJob[];
  recentSearches: RecentSearch[];
  recentQuestions: RecentQuestion[];
}

const JOB_STATES: Array<{ key: JobState; label: string; className: string }> = [
  { key: "completed", label: "Completed", className: "stroke-emerald-500" },
  { key: "active", label: "Active", className: "stroke-blue-500" },
  { key: "failed", label: "Failed", className: "stroke-red-500" },
  { key: "waiting", label: "Waiting", className: "stroke-amber-500" },
  { key: "delayed", label: "Delayed", className: "stroke-violet-500" },
];

export function AdminDashboardClient({ initialData }: { initialData: AdminDashboardData }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/stats", { cache: "no-store" });
    const next = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(next?.error ?? `Refresh failed (${res.status})`);
      return;
    }
    setData(next as AdminDashboardData);
    setLastUpdated(new Date());
    setError(null);
  }, []);

  useEffect(() => {
    if (paused) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [paused, refresh]);

  async function retry(documentId: string) {
    const res = await fetch(`/api/documents/${documentId}/retry`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Retry failed (${res.status})`);
      return;
    }
    await refresh();
  }

  const jobTotal = useMemo(
    () => JOB_STATES.reduce((sum, state) => sum + (data.jobs[state.key] ?? 0), 0),
    [data.jobs],
  );

  return (
    <div
      className="space-y-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            /{data.workspace.slug}
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Admin dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Operational snapshot for ingestion, retrieval, and answer activity.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {loading && (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Refreshing
            </span>
          )}
          <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
            className={cn(
              "h-8 rounded-md border px-3 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
              paused
                ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
            )}
          >
            {paused ? "Resume auto-refresh" : "Pause auto-refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          href="/app/documents"
          label="Documents"
          value={data.documents.total}
          detail={`${data.documents.indexed} indexed, ${data.documents.failed} failed`}
        />
        <MetricCard href="/app/documents" label="Chunks" value={data.chunks} detail="Searchable passages" />
        <MetricCard href="/app/jobs" label="Average ingest" value={formatMs(data.avgIngestMs)} detail="Indexed documents" />
        <MetricCard
          href="/app/jobs"
          label="Queue failures"
          value={data.jobs.failed ?? 0}
          detail={jobTotal ? `${jobTotal} total jobs` : "No queue history"}
          danger={(data.jobs.failed ?? 0) > 0}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-0">
          <PanelHeader title="Job states" action={<Link href="/app/jobs">Open jobs</Link>} />
          <div className="grid gap-5 p-5 md:grid-cols-[190px_1fr]">
            {jobTotal === 0 ? (
              <div className="md:col-span-2">
                <PanelEmpty title="No queue activity" description="Upload a document to create ingestion jobs." />
              </div>
            ) : (
              <>
                <JobPie jobs={data.jobs} total={jobTotal} />
                <div className="space-y-3">
                  {JOB_STATES.map((state) => (
                    <div key={state.key} className="flex items-center justify-between gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2.5 w-2.5 rounded-full", dotClass(state.key))} />
                        <span>{state.label}</span>
                      </div>
                      <span className="font-mono text-zinc-600 dark:text-zinc-300">
                        {data.jobs[state.key] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="p-0">
          <PanelHeader
            title="Recent failed jobs"
            action={<Link href="/app/jobs">View all</Link>}
          />
          {data.recentFailedJobs.length === 0 ? (
            <div className="p-5">
              <PanelEmpty title="No failed jobs" description="Failed ingestion jobs will appear here with retry actions." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Error</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentFailedJobs.map((job) => (
                    <tr key={job.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="max-w-[220px] px-4 py-3">
                        <div className="truncate font-medium">{job.document.filename}</div>
                        <div className="mt-1 font-mono text-xs text-zinc-500">{job.bullJobId}</div>
                      </td>
                      <td className="px-4 py-3">{job.attempts}</td>
                      <td className="max-w-[280px] px-4 py-3 text-red-700 dark:text-red-300">
                        <div className="truncate">{job.error ?? "Unknown failure"}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => retry(job.document.id)}>
                          Retry
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <ActivityTable
          title="Recent searches"
          href="/app/search"
          empty="Search activity will appear after users query the workspace."
          rows={data.recentSearches.map((search) => ({
            id: search.id,
            primary: search.query,
            secondary: `${search.mode} · ${search.resultCount} results`,
            meta: formatDate(search.createdAt),
            badge: search.mode,
          }))}
        />
        <ActivityTable
          title="Recent questions"
          href="/app/ask"
          empty="Answered questions will appear after Ask is used."
          rows={data.recentQuestions.map((question) => ({
            id: question.id,
            primary: question.question,
            secondary: `${question.provider}/${question.model} · ${question.answerLength} chars`,
            meta: formatDate(question.createdAt),
            badge: question.provider,
          }))}
        />
      </section>
    </div>
  );
}

function MetricCard({
  href,
  label,
  value,
  detail,
  danger = false,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  detail: string;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md border bg-white p-4 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:bg-zinc-950 dark:hover:bg-zinc-900",
        danger ? "border-red-200 dark:border-red-900" : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold", danger && "text-red-700 dark:text-red-300")}>
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{detail}</div>
    </Link>
  );
}

function PanelHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {action && <div className="text-sm font-medium text-indigo-600 hover:underline">{action}</div>}
    </div>
  );
}

function JobPie({ jobs, total }: { jobs: AdminDashboardData["jobs"]; total: number }) {
  const slices = JOB_STATES.map((state) => ({
    ...state,
    share: ((jobs[state.key] ?? 0) / total) * 100,
  }))
    .filter((state) => state.share > 0)
    .map((state, index, all) => ({
      ...state,
      offset: 25 - all.slice(0, index).reduce((sum, item) => sum + item.share, 0),
    }));

  return (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 42 42" className="h-40 w-40 -rotate-90" role="img" aria-label="Job state distribution">
        <circle cx="21" cy="21" r="15.9155" fill="none" className="stroke-zinc-100 dark:stroke-zinc-800" strokeWidth="7" />
        {slices.map((state) => (
          <circle
            key={state.key}
            cx="21"
            cy="21"
            r="15.9155"
            fill="none"
            className={state.className}
            strokeWidth="7"
            strokeDasharray={`${state.share} ${100 - state.share}`}
            strokeDashoffset={state.offset}
          />
        ))}
      </svg>
    </div>
  );
}

function ActivityTable({
  title,
  href,
  empty,
  rows,
}: {
  title: string;
  href: string;
  empty: string;
  rows: Array<{ id: string; primary: string; secondary: string; meta: string; badge: string }>;
}) {
  return (
    <Card className="p-0">
      <PanelHeader title={title} action={<Link href={href}>Open</Link>} />
      {rows.length === 0 ? (
        <div className="p-5">
          <PanelEmpty title="No activity yet" description={empty} />
        </div>
      ) : (
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <div className="truncate font-medium">{row.primary}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <Badge tone="blue">{row.badge}</Badge>
                  <span>{row.secondary}</span>
                </div>
              </div>
              <div className="text-xs text-zinc-500 md:text-right">{row.meta}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PanelEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed border-zinc-200 px-4 py-8 text-center dark:border-zinc-800">
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
    </div>
  );
}

function dotClass(state: JobState) {
  return {
    completed: "bg-emerald-500",
    active: "bg-blue-500",
    failed: "bg-red-500",
    waiting: "bg-amber-500",
    delayed: "bg-violet-500",
  }[state];
}

function formatMs(ms: number) {
  if (!ms) return "0 ms";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}
