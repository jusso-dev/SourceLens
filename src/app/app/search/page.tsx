"use client";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, Input, Spinner } from "@/components/ui";

type Mode = "keyword" | "vector" | "hybrid";

interface Hit {
  chunkId: string;
  documentId: string;
  filename: string;
  fileType: string;
  chunkIndex: number;
  text: string;
  score: number;
  source: "keyword" | "vector";
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, mode }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Search failed");
      setHits(null);
      return;
    }
    const data = await res.json();
    setHits(data.hits);
    setProvider(data.embeddingProvider);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-zinc-500">Hybrid keyword and vector retrieval, scoped to your workspace.</p>
      </div>

      <form onSubmit={onSearch} className="sl-card p-4 space-y-3">
        <Input
          autoFocus
          placeholder="Search across your documents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm">
            {(["hybrid", "vector", "keyword"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 ${mode === m ? "bg-indigo-600 text-white" : "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <Button type="submit" disabled={!query.trim() || loading}>
            {loading && <Spinner />} Search
          </Button>
        </div>
      </form>

      {error && <Card className="border-red-200 text-red-700">{error}</Card>}

      {hits === null ? (
        <EmptyState title="Run a search" description="Try semantic phrases, keywords, or whole sentences." />
      ) : hits.length === 0 ? (
        <EmptyState title="No matches" description="Try a different query or broaden your wording." />
      ) : (
        <div className="space-y-3">
          {provider && <p className="text-xs text-zinc-500">Embeddings: {provider}</p>}
          {hits.map((h, i) => (
            <Card key={h.chunkId}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">
                  {i + 1}. {h.filename} <span className="text-zinc-500">· chunk {h.chunkIndex}</span>
                </div>
                <div className="flex gap-2">
                  <Badge tone={h.source === "vector" ? "violet" : "blue"}>{h.source}</Badge>
                  <Badge tone="neutral">score {h.score.toFixed(3)}</Badge>
                </div>
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{h.text}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
