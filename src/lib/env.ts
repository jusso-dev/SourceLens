function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be number`);
  return n;
}

export const env = {
  databaseUrl: req("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-please-32chars",
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  storageDir: process.env.STORAGE_DIR ?? "./storage",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL ?? "gemma3:4b",
  ollamaEmbedModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  embeddingDim: num("EMBEDDING_DIM", 768),
  maxUploadBytes: num("MAX_UPLOAD_BYTES", 26_214_400),
};

export type Env = typeof env;
