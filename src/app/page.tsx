import Link from "next/link";
import { getSession } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui";

export default async function Landing() {
  const session = await getSession();
  if (session?.user) redirect("/app");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl mx-auto w-full">
        <div className="flex items-center gap-2 font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white">SL</span>
          SourceLens
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="text-zinc-700 dark:text-zinc-300 hover:underline">Login</Link>
          <Link href="/signup"><Button size="sm">Sign up</Button></Link>
        </nav>
      </header>
      <section className="flex-1 max-w-3xl mx-auto px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">
          Production-grade RAG, batteries included
        </span>
        <h1 className="mt-4 text-4xl sm:text-5xl font-semibold tracking-tight">
          Enterprise search & RAG for your team&apos;s documents.
        </h1>
        <p className="mt-5 text-lg text-zinc-600 dark:text-zinc-400">
          Multi-tenant workspaces, hybrid keyword + vector retrieval, source-cited answers.
          Backed by Postgres + pgvector and a BullMQ ingestion pipeline.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/signup"><Button>Get started</Button></Link>
          <Link href="/login"><Button variant="secondary">Login</Button></Link>
        </div>
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          {[
            { t: "Hybrid search", d: "Full-text + pgvector cosine, fused with reciprocal rank fusion." },
            { t: "Background ingestion", d: "BullMQ workers chunk, embed, and index documents asynchronously." },
            { t: "Cited answers", d: "Every answer links back to source chunks, with retrieval scores." },
          ].map((f) => (
            <div key={f.t} className="sl-card">
              <div className="font-semibold mb-1">{f.t}</div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
