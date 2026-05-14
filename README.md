# SourceLens

[![CI](https://github.com/jusso-dev/SourceLens/actions/workflows/ci.yml/badge.svg)](https://github.com/jusso-dev/SourceLens/actions/workflows/ci.yml)

> Production-style enterprise document search & RAG platform — multi-tenant
> workspaces, hybrid keyword + vector retrieval, source-cited answers, and a
> BullMQ-backed ingestion pipeline.

This project demonstrates senior full-stack and AI-engineering work end to end:
authenticated workspaces, document ingestion with background workers, pgvector
similarity search fused with full-text keyword search, retrieval-augmented
answers with citations, and an operational dashboard.

---

## Table of contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Ingestion pipeline](#ingestion-pipeline)
- [Search architecture](#search-architecture)
- [RAG flow](#rag-flow)
- [Provider chain](#provider-chain)
- [Security & tenant isolation](#security--tenant-isolation)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)

---

## Architecture

```mermaid
flowchart LR
  U[User Browser] -->|HTTPS| W[Next.js App Router]
  W -->|better-auth session| AUTH[(Auth tables)]
  W -->|Prisma| PG[(PostgreSQL + pgvector)]
  W -->|BullMQ enqueue| RDS[(Redis)]
  WORKER[Ingestion Worker] -->|consume| RDS
  WORKER -->|extract → chunk → embed| PROV{Provider chain}
  WORKER -->|write chunks + vectors| PG
  W -->|search & ask| PG
  W -->|chat| PROV
  subgraph Providers
    PROV -->|primary| CLA[Claude Agent SDK]
    PROV -->|fallback| OL[Ollama gemma3 / nomic-embed-text]
    PROV -->|final fallback| MK[Deterministic mock]
  end
```

Two long-running processes: the Next.js app (HTTP) and a separate BullMQ worker
(`pnpm worker`). They share the Postgres database and Redis queue.

---

## Tech stack

| Layer        | Choice                                                     |
|--------------|------------------------------------------------------------|
| Framework    | Next.js 16 (App Router) · React 19 · TypeScript            |
| Styling      | Tailwind CSS v4 (hand-rolled UI primitives)                |
| Database     | PostgreSQL 16 + `pgvector` (Prisma ORM, `vector(768)`)     |
| Queue        | Redis 7 + BullMQ (ingestion worker, retries, retention)    |
| Auth         | [better-auth](https://better-auth.com) (email + password)  |
| LLM          | Claude Agent SDK → Ollama `gemma3:4b` → mock (fallback)    |
| Embeddings   | Ollama `nomic-embed-text` (768-dim) → deterministic mock   |
| File parsing | `pdf-parse`, `mammoth` (DOCX), native UTF-8 (TXT/MD)       |
| Validation   | Zod                                                        |

---

## Quick start

### 1. Start infra

```bash
cp .env.example .env
docker compose up -d postgres redis
# optional: local LLM/embeddings
docker compose --profile ollama up -d ollama
docker exec -it $(docker ps -qf name=ollama) ollama pull nomic-embed-text
docker exec -it $(docker ps -qf name=ollama) ollama pull gemma3:4b
# optional: S3-compatible storage for uploads
docker compose --profile s3 up -d minio minio-create-bucket
```

### 2. Install + migrate

```bash
pnpm install
pnpm db:setup       # db push + pgvector + index + seed demo data
```

`db:setup` runs:

1. `prisma db push` — creates tables and enables the `vector` extension.
2. `prisma/post-deploy.sql` — adds the HNSW index on `Chunk.embedding` and a GIN
   index on the tsvector expression of `Chunk.text`.
3. `prisma/seed.ts` — creates a demo user, workspace and three pre-indexed sample
   documents.

### 3. Run the app + worker

```bash
# terminal 1
pnpm dev

# terminal 2
pnpm worker
```

Open <http://localhost:3000>.

**Demo login:** `demo@sourcelens.dev` / `sourcelens-demo`

---

## Environment variables

See `.env.example` for the full list. Notable:

| Var                  | Purpose                                                  |
|----------------------|----------------------------------------------------------|
| `DATABASE_URL`       | Postgres connection (must have `pgvector` available).    |
| `REDIS_URL`          | Redis for BullMQ.                                        |
| `BETTER_AUTH_SECRET` | Server secret for cookie/session signing.                |
| `STORAGE_BACKEND`    | `local` by default; set `s3` for S3/R2/MinIO-compatible object storage. |
| `STORAGE_DIR`        | Local upload root when using `STORAGE_BACKEND=local`.    |
| `S3_*`               | Endpoint, region, bucket and credentials for the S3 backend. |
| `ANTHROPIC_API_KEY`  | Optional. Enables Claude Agent SDK chat.                 |
| `OLLAMA_HOST`        | Defaults to `http://localhost:11434`.                    |
| `EMBEDDING_DIM`      | Must match the `vector(N)` column in `schema.prisma`.    |
| `MAX_UPLOAD_BYTES`   | Per-file upload size limit.                              |

---

## Ingestion pipeline

```
upload → POST /api/documents
       → saveUpload (local FS or S3-compatible object storage)
       → Document row {status: uploaded}
       → enqueueIngest(documentId)
worker  ← BullMQ "ingest" queue
        → extractText (pdf-parse / mammoth / utf-8)
        → chunkText  (~2000 chars, paragraph-aware, 200-char overlap)
        → embedTexts (Ollama nomic-embed-text → mock)
        → INSERT chunks + vectors (single transaction, raw SQL for pgvector)
        → Document {status: indexed, ingestDurationMs}
        → IngestJob {state: completed}
```

Failures: BullMQ retries 3× with exponential backoff. Final failure flips
`Document.status = failed` and writes the error message. The Documents and Jobs
pages surface a one-click **Retry** action.

---

## Search architecture

Three modes on `POST /api/search`:

- **keyword** — Postgres `to_tsvector('english', text) @@ websearch_to_tsquery`
  ranked by `ts_rank`. Uses the `chunk_text_fts` GIN index.
- **vector** — pgvector cosine distance (`embedding <=> query_vector`), HNSW
  index for ANN.
- **hybrid** (default) — top-25 of each, fused with reciprocal rank fusion
  (k = 60).

All queries are scoped by `workspaceId` in the WHERE clause — there is no path
by which a chunk from another workspace can appear in a result.

---

## Storage backends

Uploads go through `src/lib/storage`, which selects an adapter with
`STORAGE_BACKEND`.

- `local` stores files under `STORAGE_DIR` and records `Document.storagePath` as
  a relative filesystem path such as `workspaceId/object-name.pdf`.
- `s3` streams uploads through the Next.js server to any S3-compatible API and
  records `Document.storagePath` as `s3://bucket/key`.
- `azure` is reserved for a later adapter and fails fast if selected.

For local MinIO testing:

```bash
docker compose --profile s3 up -d minio minio-create-bucket
```

Then set:

```env
STORAGE_BACKEND=s3
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=sourcelens
S3_ACCESS_KEY_ID=sourcelens
S3_SECRET_ACCESS_KEY=sourcelens-secret
S3_FORCE_PATH_STYLE=true
```

---

## RAG flow

`POST /api/ask` (`Ask` page) does:

1. Hybrid search top-6 chunks for the question.
2. Compose a system prompt + numbered context block.
3. Call the chat provider chain.
4. Persist the (`question`, `answer`, citations, model, provider,
   retrievalScore) row in `Question`.
5. Return the answer plus citations and full context text for the UI.

Citations render directly under the answer with score + filename + chunk
number, so any sentence can be verified against its source.

---

## Provider chain

Both embeddings and chat use ordered fallback chains. The first provider that
succeeds wins; on failure or unavailability the next provider is tried.

**Embeddings:**

1. Ollama `nomic-embed-text` (768 dim) — used when `/api/tags` responds.
2. Deterministic SHA-256-derived mock vector — always available.

**Chat:**

1. **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) when
   `ANTHROPIC_API_KEY` is set.
2. **Ollama `gemma3:4b`** local model when reachable.
3. **Mock** — returns the top retrieved chunks as a labelled `[DEMO MODE]`
   answer, so the UI always renders something usable.

The chain means the project runs end-to-end with **no paid API keys** and
without an internet connection (set up Ollama with `gemma3` and
`nomic-embed-text` for real models, or accept the deterministic mock for tests).

---

## Security & tenant isolation

- Every API route resolves the caller's user via better-auth and the **current
  workspace** via `requireCurrentWorkspace()`. There is no path to query another
  workspace's data.
- All SQL — including the raw vector and full-text queries — joins on
  `workspaceId` so an attacker manipulating a chunk id cannot fetch foreign
  data.
- Uploaded files are size-checked (`MAX_UPLOAD_BYTES`) and type-checked against
  an allowlist of MIMEs / extensions.
- Storage paths are workspace-prefixed and stem-sanitised before being written.
- Per-user token-bucket rate limits on upload / search / ask / retry; 429 with
  `Retry-After` + `X-RateLimit-*` headers. Configurable via `RATE_LIMIT_*` env.
- Per-IP anonymous limits on sign-in / sign-up / password reset / verification
  resend / public invitation lookup. `TRUST_PROXY=1` enables `X-Forwarded-For`
  / `Forwarded` parsing; without it the limiter falls back to a single shared
  bucket to refuse spoofed identities.
- Email verification (opt-in via `BETTER_AUTH_REQUIRE_EMAIL_VERIFICATION=true`)
  and password reset both go through the email provider chain (#22). Reset
  links expire in 1 hour, verify links in 24 hours.
- **Prompt-injection guard** (`src/lib/rag/sanitise.ts`) inspects every
  retrieved chunk before it reaches the LLM, flags risky patterns
  (`ignore_previous`, `role_directive`, `tag_break`, `boundary_marker`,
  `long_base64`, `hidden_unicode`) and either warns, strips or blocks based on
  `RAG_INJECTION_MODE`. Each chunk is wrapped in a `<source warnings="...">`
  block in the prompt so the model has explicit metadata about untrusted input,
  and the Ask page surfaces flags as badges next to each citation.
- Secrets never reach the client: only `BETTER_AUTH_URL` and public Next.js
  values are exposed.

---

## Testing

```bash
pnpm test            # Vitest unit suite (≈ 60 tests, sub-second)
pnpm test:coverage   # with v8 coverage
pnpm test:e2e        # Playwright smoke (signup → upload → ingest → search → ask)
```

Unit tests cover the chunker, RRF fusion, provider chain demotion, streaming
chain demotion, the rate-limit Lua semantics, the RBAC rank helper, both Zod
schemas, the workspace auth helpers, and the deterministic mock embeddings.

The Playwright smoke spins up the dev server **and** the BullMQ worker via
Playwright's `webServer` array; both processes are torn down when the run
finishes. CI workflows live at `.github/workflows/{ci,e2e}.yml` and run against
Postgres + Redis service containers.

---

## Known limitations

- **DOCX path** depends on `mammoth`; complex Word features (tables, images)
  are dropped to plain text.
- **Server-mediated uploads** still route through the Next.js app before
  reaching local disk or S3. Browser-to-object-storage presigned uploads are a
  later milestone.
- **Invitation emails** are real via Resend or SMTP when configured; the
  default `console` provider logs the email to stdout for dev. Email
  verification + password reset wiring through better-auth is `#14`.
- **No reranker** over the fused top-N before the LLM (#7); model swaps in the
  embedding provider require a full re-ingest until #17 lands.

## Future improvements

- Workspace switcher and invitations UI.
- Streaming RAG answers (SSE) and inline citation highlighting on hover.
- Re-ranker pass over the fused top-N before sending to the LLM.
- Per-document delete from search index without re-running the worker.
- Bull Board mount at `/internal/bull` for queue ops.
- OpenTelemetry traces across upload → ingest → search.
