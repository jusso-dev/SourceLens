import { env } from "@/lib/env";
import { claudeAgentChat } from "./claude";
import { mockChat, mockEmbeddings } from "./mock";
import { ollamaAvailable, ollamaChat, ollamaEmbeddings } from "./ollama";
import type { ChatInput, ChatResult, EmbeddingProvider } from "./types";

/** Embed texts with the first provider that succeeds.
 *  Chain: Ollama (if reachable) → mock (always). */
export async function embedTexts(texts: string[]): Promise<{
  vectors: number[][];
  provider: EmbeddingProvider["name"];
  dim: number;
}> {
  if (texts.length === 0) return { vectors: [], provider: "noop", dim: env.embeddingDim };
  if (await ollamaAvailable()) {
    try {
      const vectors = await ollamaEmbeddings.embed(texts);
      return { vectors, provider: ollamaEmbeddings.name, dim: ollamaEmbeddings.dim };
    } catch (err) {
      console.warn("[providers] ollama embed failed, falling back to mock:", err);
    }
  }
  const vectors = await mockEmbeddings.embed(texts);
  return { vectors, provider: mockEmbeddings.name, dim: mockEmbeddings.dim };
}

/** Answer a RAG question with the first chat provider that succeeds.
 *  Chain: Claude Agent SDK (if ANTHROPIC_API_KEY set) → Ollama (if reachable) → mock. */
export async function answerQuestion(input: ChatInput): Promise<ChatResult> {
  if (env.anthropicApiKey) {
    try {
      return await claudeAgentChat.answer(input);
    } catch (err) {
      console.warn("[providers] claude-agent-sdk failed, falling back:", err);
    }
  }
  if (await ollamaAvailable()) {
    try {
      return await ollamaChat.answer(input);
    } catch (err) {
      console.warn("[providers] ollama chat failed, falling back to mock:", err);
    }
  }
  return mockChat.answer(input);
}

export { mockChat, mockEmbeddings, ollamaChat, ollamaEmbeddings, claudeAgentChat };
export type { ChatInput, ChatResult, EmbeddingProvider } from "./types";
