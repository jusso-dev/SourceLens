import { env } from "@/lib/env";
import { claudeAgentChat } from "./claude";
import { mockChat, mockEmbeddings } from "./mock";
import { ollamaAvailable, ollamaChat, ollamaEmbeddings } from "./ollama";
import type {
  ChatInput,
  ChatProvider,
  ChatResult,
  EmbeddingProvider,
  StreamEvent,
} from "./types";

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

/** Stream a RAG answer through the same provider chain as `answerQuestion`.
 *  Yields `delta` events as tokens arrive and a final `done` event with the
 *  complete `ChatResult`. On error mid-stream the chain demotes to the next
 *  provider — callers see a single continuous stream regardless. */
export async function* streamAnswer(input: ChatInput): AsyncGenerator<StreamEvent> {
  const tryProvider = async function* (p: ChatProvider): AsyncGenerator<StreamEvent> {
    if (!p.stream) {
      const r = await p.answer(input);
      yield { type: "delta", text: r.answer };
      yield { type: "done", result: r };
      return;
    }
    yield* p.stream(input);
  };

  const chain: Array<() => Promise<ChatProvider | null>> = [
    async () => (env.anthropicApiKey ? claudeAgentChat : null),
    async () => ((await ollamaAvailable()) ? ollamaChat : null),
    async () => mockChat,
  ];

  for (const get of chain) {
    const provider = await get();
    if (!provider) continue;
    try {
      yield* tryProvider(provider);
      return;
    } catch (err) {
      console.warn(`[providers] streaming ${provider.name} failed, demoting:`, err);
    }
  }
}

export { mockChat, mockEmbeddings, ollamaChat, ollamaEmbeddings, claudeAgentChat };
export type { ChatInput, ChatResult, EmbeddingProvider, Reranker, StreamEvent } from "./types";
