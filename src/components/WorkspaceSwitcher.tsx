"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function WorkspaceSwitcher({
  initialName,
  initialSlug,
  initialId,
}: {
  initialName: string;
  initialSlug: string;
  initialId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [currentId, setCurrentId] = useState(initialId);
  const [currentName, setCurrentName] = useState(initialName);
  const [currentSlug, setCurrentSlug] = useState(initialSlug);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const r = await fetch("/api/workspaces", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        setWorkspaces(data.workspaces);
        if (data.currentWorkspaceId) setCurrentId(data.currentWorkspaceId);
      }
    })();
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function switchTo(id: string, name: string, slug: string) {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/workspaces/${id}/switch`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return;
    setCurrentId(id);
    setCurrentName(name);
    setCurrentSlug(slug);
    setOpen(false);
    router.refresh();
  }

  async function createNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    const r = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setBusy(false);
    if (!r.ok) return;
    const data = await r.json();
    setNewName("");
    setCreating(false);
    setOpen(false);
    setCurrentId(data.workspace.id);
    setCurrentName(data.workspace.name);
    setCurrentSlug(data.workspace.slug);
    router.refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        <span className="flex items-center gap-2 truncate">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white text-xs font-semibold">
            {currentName.slice(0, 2).toUpperCase()}
          </span>
          <span className="truncate">
            <span className="block font-semibold leading-tight truncate">{currentName}</span>
            <span className="block text-xs text-zinc-500 truncate">/{currentSlug}</span>
          </span>
        </span>
        <span className="text-zinc-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 top-[calc(100%+4px)] left-0 right-0 sl-card p-2 shadow-lg">
          {workspaces === null ? (
            <div className="p-2 text-sm text-zinc-500 flex items-center gap-2"><Spinner /> Loading…</div>
          ) : (
            <>
              <div className="text-xs uppercase text-zinc-500 px-2 pt-1 pb-2">Workspaces</div>
              <ul className="max-h-64 overflow-auto">
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <button
                      onClick={() => switchTo(w.id, w.name, w.slug)}
                      disabled={busy}
                      className={`w-full text-left flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900 ${w.id === currentId ? "bg-zinc-50 dark:bg-zinc-900" : ""}`}
                    >
                      <span className="truncate">{w.name}</span>
                      <span className="text-xs text-zinc-500 ml-2">{w.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-zinc-200 dark:border-zinc-800 mt-2 pt-2">
                {creating ? (
                  <form onSubmit={createNew} className="px-2 py-1 space-y-2">
                    <input
                      autoFocus
                      placeholder="Workspace name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full h-9 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setCreating(false)} className="text-xs text-zinc-500">Cancel</button>
                      <button type="submit" disabled={busy} className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50">Create</button>
                    </div>
                  </form>
                ) : (
                  <button
                    onClick={() => setCreating(true)}
                    className="w-full text-left rounded-md px-2 py-2 text-sm text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                  >
                    + Create workspace
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
