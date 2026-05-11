import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ollama", () => ({
  ollamaAvailable: vi.fn(),
  ollamaChat: {
    name: "ollama",
    model: "gemma3:4b",
    answer: vi.fn(),
    stream: vi.fn(),
  },
  ollamaEmbeddings: { name: "ollama", dim: 768, embed: vi.fn() },
  formatContexts: () => "",
  defaultSystemPrompt: () => "",
}));

vi.mock("../claude", () => ({
  claudeAgentChat: {
    name: "claude-agent-sdk",
    model: "claude-test",
    answer: vi.fn(),
    stream: vi.fn(),
  },
}));

import { env } from "@/lib/env";
import * as claude from "../claude";
import * as ollama from "../ollama";
import { streamAnswer } from "../index";
import type { StreamEvent } from "../types";

const mocked = {
  available: vi.mocked(ollama.ollamaAvailable),
  claudeStream: vi.mocked(claude.claudeAgentChat.stream!),
  ollamaStream: vi.mocked(ollama.ollamaChat.stream!),
};

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const x of items) yield x;
}

beforeEach(() => {
  vi.clearAllMocks();
  env.anthropicApiKey = "";
});

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streamAnswer chain", () => {
  it("streams from Claude when API key is set", async () => {
    env.anthropicApiKey = "sk-test";
    const events: StreamEvent[] = [
      { type: "delta", text: "hello " },
      { type: "delta", text: "world" },
      { type: "done", result: { answer: "hello world", provider: "claude-agent-sdk", model: "m" } },
    ];
    mocked.claudeStream.mockReturnValue(asyncIter(events));

    const out = await collect(streamAnswer({ question: "q?", contexts: [] }));
    expect(out.filter((e) => e.type === "delta")).toHaveLength(2);
    const done = out.find((e) => e.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.result.provider).toBe("claude-agent-sdk");
  });

  it("falls back to Ollama when Claude stream throws", async () => {
    env.anthropicApiKey = "sk-test";
    async function* failing(): AsyncGenerator<StreamEvent> {
      throw new Error("claude down");
      yield { type: "delta", text: "" }; // unreachable, keeps TS happy
    }
    mocked.claudeStream.mockReturnValue(failing());
    mocked.available.mockResolvedValue(true);
    mocked.ollamaStream.mockReturnValue(
      asyncIter<StreamEvent>([
        { type: "delta", text: "from ollama" },
        { type: "done", result: { answer: "from ollama", provider: "ollama", model: "g" } },
      ]),
    );

    const out = await collect(streamAnswer({ question: "q?", contexts: [] }));
    const done = out.find((e) => e.type === "done");
    if (done?.type === "done") expect(done.result.provider).toBe("ollama");
  });

  it("falls back to mock when nothing else is available", async () => {
    mocked.available.mockResolvedValue(false);
    const out = await collect(streamAnswer({ question: "what?", contexts: [] }));
    const done = out.find((e) => e.type === "done");
    if (done?.type === "done") expect(done.result.provider).toBe("mock");
    expect(out.some((e) => e.type === "delta")).toBe(true);
  });
});
