"use client";
import { useRef, useState } from "react";
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
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [contexts, setContexts] = useState<Ctx[] | null>(null);
  const [final, setFinal] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFinal(null);
    setStreamText("");
    setContexts(null);
    setStreaming(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/ask?stream=1", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ question }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const txt = await res.text();
        let parsed: unknown;
        try { parsed = JSON.parse(txt); } catch { parsed = { error: txt }; }
        const msg = (parsed as { error?: string }).error ?? `Ask failed (${res.status})`;
        setError(msg);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // keep last partial
        for (const raw of events) {
          const parsed = parseSse(raw);
          if (!parsed) continue;
          handleEvent(parsed);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleEvent(evt: { event: string; data: unknown }) {
    if (evt.event === "ctx") {
      const d = evt.data as { contexts: Ctx[] };
      setContexts(d.contexts);
    } else if (evt.event === "delta") {
      const d = evt.data as { text: string };
      setStreamText((prev) => prev + d.text);
    } else if (evt.event === "done") {
      setFinal(evt.data as AskResult);
      setStreamText((evt.data as AskResult).answer);
    } else if (evt.event === "error") {
      const d = evt.data as { error: string };
      setError(d.error);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask</h1>
        <p className="text-sm text-zinc-500">Question-answer over your workspace documents, streamed with citations.</p>
      </div>

      <form onSubmit={onSubmit} className="sl-card p-4 space-y-3">
        <Textarea
          placeholder="Ask anything about your indexed documents…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          disabled={streaming}
        />
        <div className="flex justify-end gap-2">
          {streaming && <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>}
          <Button type="submit" disabled={question.trim().length < 3 || streaming}>
            {streaming && <Spinner />} {streaming ? "Streaming…" : "Ask"}
          </Button>
        </div>
      </form>

      {error && <Card className="border-red-200 text-red-700">{error}</Card>}

      {!streaming && !streamText && !error && (
        <EmptyState title="No question asked yet" description="Type a question above to retrieve sources and generate a cited answer." />
      )}

      {(streaming || streamText) && (
        <Card>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            {final ? (
              <>
                <Badge tone="blue">{final.provider}</Badge>
                <span>{final.model}</span>
              </>
            ) : (
              <Badge tone="amber">streaming…</Badge>
            )}
          </div>
          <div className="mt-3 text-sm whitespace-pre-wrap leading-relaxed">
            {streamText}
            {streaming && <span className="inline-block w-2 h-4 bg-zinc-400 align-text-bottom animate-pulse ml-0.5" />}
          </div>
        </Card>
      )}

      {(contexts ?? final?.contexts) && (contexts ?? final?.contexts)!.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Sources</h2>
          <div className="space-y-2">
            {(contexts ?? final?.contexts)!.map((c, i) => (
              <Card key={c.chunkId}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    [{i + 1}] {c.filename} <span className="text-zinc-500">· chunk {c.chunkIndex}</span>
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
  );
}

function parseSse(raw: string): { event: string; data: unknown } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
