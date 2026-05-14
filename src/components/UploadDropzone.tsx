"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Spinner, cn } from "@/components/ui";

type UploadState = "queued" | "uploading" | "uploaded" | "failed";

interface UploadItem {
  id: string;
  file: File;
  state: UploadState;
  progress: number;
  error: string | null;
}

const CONCURRENCY = Number(process.env.NEXT_PUBLIC_UPLOAD_CONCURRENCY ?? "3") || 3;

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef(0);
  const startedRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      state: "queued" as const,
      progress: 0,
      error: null,
    }));
    setItems((current) => [...next, ...current]);
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const upload = useCallback(
    (item: UploadItem) => {
      activeRef.current += 1;
      updateItem(item.id, { state: "uploading", progress: 0, error: null });

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/documents");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        updateItem(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
      };
      xhr.onload = () => {
        activeRef.current -= 1;
        if (xhr.status >= 200 && xhr.status < 300) {
          updateItem(item.id, { state: "uploaded", progress: 100, error: null });
          onUploaded();
          setTimeout(() => {
            setItems((current) => current.filter((candidate) => candidate.id !== item.id));
          }, 1600);
        } else {
          updateItem(item.id, {
            state: "failed",
            error: parseError(xhr.responseText, xhr.status),
          });
        }
      };
      xhr.onerror = () => {
        activeRef.current -= 1;
        updateItem(item.id, { state: "failed", error: "Network error" });
      };

      const form = new FormData();
      form.append("file", item.file);
      xhr.send(form);
    },
    [onUploaded, updateItem],
  );

  useEffect(() => {
    const slots = Math.max(0, CONCURRENCY - activeRef.current);
    if (slots === 0) return;
    const queued = items.filter((item) => item.state === "queued" && !startedRef.current.has(item.id));
    queued.slice(0, slots).forEach((item) => {
      startedRef.current.add(item.id);
      upload(item);
    });
  }, [items, upload]);

  const activeCount = useMemo(
    () => items.filter((item) => item.state === "queued" || item.state === "uploading").length,
    [items],
  );

  function retry(item: UploadItem) {
    startedRef.current.delete(item.id);
    updateItem(item.id, { state: "queued", progress: 0, error: null });
  }

  return (
    <section
      className={cn(
        "rounded-md border border-dashed p-4 transition-colors",
        dragging
          ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950"
          : "border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-950",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
      }}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Upload documents</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Drop PDFs, Markdown, text, or DOCX files here. Up to {CONCURRENCY} upload at once.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.docx"
          className="hidden"
          onChange={(event) => {
            if (event.target.files?.length) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
      </div>

      {items.length > 0 && (
        <div className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((item) => (
            <div key={item.id} className="grid gap-3 p-3 text-sm md:grid-cols-[1fr_160px_auto] md:items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{item.file.name}</div>
                <div className="mt-1 text-xs text-zinc-500">{formatSize(item.file.size)}</div>
                {item.error && <div className="mt-1 truncate text-xs text-red-600">{item.error}</div>}
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={cn(
                      "h-full transition-[width]",
                      item.state === "failed" ? "bg-red-500" : "bg-indigo-600",
                    )}
                    style={{ width: `${item.progress}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-zinc-500">{statusText(item)}</div>
              </div>
              <div className="flex justify-end">
                {item.state === "uploading" && <Spinner />}
                {item.state === "failed" && (
                  <Button size="sm" variant="secondary" onClick={() => retry(item)}>
                    Retry
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeCount > 0 && (
        <div className="mt-3 text-xs text-zinc-500">
          {activeCount} file{activeCount === 1 ? "" : "s"} queued or uploading
        </div>
      )}
    </section>
  );
}

function parseError(responseText: string, status: number) {
  try {
    const body = JSON.parse(responseText) as { error?: string };
    return body.error ?? `Upload failed (${status})`;
  } catch {
    return `Upload failed (${status})`;
  }
}

function statusText(item: UploadItem) {
  if (item.state === "queued") return "Queued";
  if (item.state === "failed") return "Failed";
  if (item.state === "uploaded") return "Created";
  return `${item.progress}%`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
