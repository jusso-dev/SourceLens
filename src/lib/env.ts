/**
 * Centralised, validated environment configuration.
 *
 * Every consumer imports the typed `env` object instead of touching
 * `process.env` directly. Validation runs once at module load with zod and
 * either succeeds (returning a frozen object) or fails fast with a clear
 * multi-line diagnostic that lists every missing / invalid variable.
 *
 * Production safety:
 *  - `BETTER_AUTH_SECRET` must be set and at least 32 chars when
 *    NODE_ENV=production. The dev default is rejected at boot.
 *  - URLs are validated; truly empty optional secrets resolve to `""`.
 *  - Numeric envs are validated with explicit ranges; out-of-range values
 *    abort startup rather than silently masking bugs.
 */

import { z } from "zod";

const DEV_AUTH_SECRET = "dev-only-secret-change-me-please-32chars";

const numeric = (defaultValue: number, opts: { min?: number; max?: number } = {}) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return defaultValue;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a finite number" });
        return z.NEVER;
      }
      if (opts.min !== undefined && n < opts.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be ≥ ${opts.min}` });
        return z.NEVER;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must be ≤ ${opts.max}` });
        return z.NEVER;
      }
      return n;
    });

const bool = (defaultValue = false) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw === "") return defaultValue;
      if (typeof raw === "boolean") return raw;
      return raw === "1" || raw.toLowerCase() === "true";
    });

const httpUrl = z
  .string()
  .url("must be a valid http(s) URL")
  .refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (postgres connection string)"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  BETTER_AUTH_SECRET: z.string().default(DEV_AUTH_SECRET),
  BETTER_AUTH_URL: httpUrl.default("http://localhost:3000"),

  STORAGE_BACKEND: z.enum(["local", "s3", "azure"]).default("local"),
  STORAGE_DIR: z.string().min(1).default("./storage"),
  S3_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: bool(false),

  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-6"),

  RERANKER: z.enum(["cohere", "voyage", "ollama", "none"]).default("none"),
  COHERE_API_KEY: z.string().default(""),
  COHERE_RERANK_MODEL: z.string().min(1).default("rerank-v3.5"),
  VOYAGE_API_KEY: z.string().default(""),
  VOYAGE_RERANK_MODEL: z.string().min(1).default("rerank-2.5"),

  OLLAMA_HOST: httpUrl.default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().min(1).default("gemma3:4b"),
  OLLAMA_EMBED_MODEL: z.string().min(1).default("nomic-embed-text"),
  OLLAMA_RERANK_MODEL: z.string().min(1).default("mxbai-rerank-large"),

  // 1..8192 covers every embedding model worth shipping; out-of-band values
  // almost always mean a config typo.
  EMBEDDING_DIM: numeric(768, { min: 1, max: 8192 }),
  // 1 KiB .. 1 GiB. Beyond 1 GiB the body buffer is its own problem.
  MAX_UPLOAD_BYTES: numeric(26_214_400, { min: 1024, max: 1_073_741_824 }),
  // Cap on raw extracted text fed to the chunker. Protects against
  // pathological PDFs that decompress into hundreds of MB of text.
  MAX_EXTRACTED_CHARS: numeric(5_000_000, { min: 1024, max: 50_000_000 }),
});

type ParsedEnv = z.infer<typeof schema>;

function parse(): ParsedEnv {
  const result = schema.safeParse(process.env);
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
}

const parsed = parse();

if (parsed.NODE_ENV === "production") {
  if (parsed.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to a strong random value in production " +
        "(refusing to start with the dev default).",
    );
  }
  if (parsed.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production");
  }
}

// Not frozen: a small number of tests mutate fields like `anthropicApiKey` to
// flip provider chain branches without re-importing the module. Treat reads
// as the source of truth; never mutate from production code paths.
export const env = {
  nodeEnv: parsed.NODE_ENV,
  isProduction: parsed.NODE_ENV === "production",
  isTest: parsed.NODE_ENV === "test",

  databaseUrl: parsed.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,

  betterAuthSecret: parsed.BETTER_AUTH_SECRET,
  betterAuthUrl: parsed.BETTER_AUTH_URL,

  storageBackend: parsed.STORAGE_BACKEND,
  storageDir: parsed.STORAGE_DIR,
  s3Endpoint: parsed.S3_ENDPOINT,
  s3Region: parsed.S3_REGION,
  s3Bucket: parsed.S3_BUCKET,
  s3AccessKeyId: parsed.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: parsed.S3_SECRET_ACCESS_KEY,
  s3ForcePathStyle: parsed.S3_FORCE_PATH_STYLE,

  anthropicApiKey: parsed.ANTHROPIC_API_KEY,
  anthropicModel: parsed.ANTHROPIC_MODEL,

  reranker: parsed.RERANKER,
  cohereApiKey: parsed.COHERE_API_KEY,
  cohereRerankModel: parsed.COHERE_RERANK_MODEL,
  voyageApiKey: parsed.VOYAGE_API_KEY,
  voyageRerankModel: parsed.VOYAGE_RERANK_MODEL,

  ollamaHost: parsed.OLLAMA_HOST,
  ollamaChatModel: parsed.OLLAMA_CHAT_MODEL,
  ollamaEmbedModel: parsed.OLLAMA_EMBED_MODEL,
  ollamaRerankModel: parsed.OLLAMA_RERANK_MODEL,

  embeddingDim: parsed.EMBEDDING_DIM,
  maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
  maxExtractedChars: parsed.MAX_EXTRACTED_CHARS,
};

export type Env = typeof env;
