"use client";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, Spinner, Textarea } from "@/components/ui";

interface Citation {
  n: number;
  chunkId: string;
  documentId: string;
  filename: string;
  chunkIndex: number;
  score: number;
}
interface Ctx extends Citation { text: string }
interface AskResult {
  id: string;
  answer: string;
  provider: string;
  model: string;
  citations: Citation[];
  contexts: Ctx[];
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Ask failed");
      return;
    }
    setResult(await res.json());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask</h1>
        <p className="text-sm text-zinc-500">Question-answer over your workspace documents, with citations.</p>
      </div>

      <form onSubmit={onSubmit} className="sl-card p-4 space-y-3">
        <Textarea
          placeholder="Ask anything about your indexed documents…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={question.trim().length < 3 || loading}>
            {loading && <Spinner />} Ask
          </Button>
        </div>
      </form>

      {error && <Card className="border-red-200 text-red-700">{error}</Card>}

      {!result && !loading && !error && (
        <EmptyState title="No question asked yet" description="Type a question above to retrieve sources and generate a cited answer." />
      )}

      {result && (
        <div className="space-y-4">
          <Card>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Badge tone="blue">{result.provider}</Badge>
              <span>{result.model}</span>
            </div>
            <div className="mt-3 text-sm whitespace-pre-wrap leading-relaxed">{result.answer}</div>
          </Card>

          {result.contexts.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-2">Sources</h2>
              <div className="space-y-2">
                {result.contexts.map((c) => (
                  <Card key={c.chunkId}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">
                        [{c.n}] {c.filename} <span className="text-zinc-500">· chunk {c.chunkIndex}</span>
                      </div>
                      <Badge tone="neutral">score {c.score.toFixed(3)}</Badge>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{c.text}</p>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
