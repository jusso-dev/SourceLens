// Set env BEFORE any module loads `@/lib/env`.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.BETTER_AUTH_SECRET ??= "test-secret-must-be-at-least-32-characters-long";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.STORAGE_DIR ??= "./storage";
process.env.OLLAMA_HOST ??= "http://invalid-host.invalid:11434";
process.env.OLLAMA_CHAT_MODEL ??= "gemma3:4b";
process.env.OLLAMA_EMBED_MODEL ??= "nomic-embed-text";
process.env.EMBEDDING_DIM ??= "768";
process.env.MAX_UPLOAD_BYTES ??= "26214400";
process.env.ANTHROPIC_API_KEY ??= "";
process.env.RERANKER ??= "none";
process.env.COHERE_API_KEY ??= "";
process.env.VOYAGE_API_KEY ??= "";
