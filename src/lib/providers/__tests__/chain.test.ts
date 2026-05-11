import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ollama", () => ({
  ollamaAvailable: vi.fn(),
  ollamaChat: { name: "ollama", model: "gemma3:4b", answer: vi.fn() },
  ollamaEmbeddings: { name: "ollama", dim: 768, embed: vi.fn() },
  formatContexts: () => "",
  defaultSystemPrompt: () => "",
}));

vi.mock("../claude", () => ({
  claudeAgentChat: { name: "claude-agent-sdk", model: "claude-test", answer: vi.fn() },
}));

import { env } from "@/lib/env";
import * as claude from "../claude";
import * as ollama from "../ollama";
import { answerQuestion, embedTexts } from "../index";

const mocked = {
  ollamaAvailable: vi.mocked(ollama.ollamaAvailable),
  ollamaChat: vi.mocked(ollama.ollamaChat.answer),
  ollamaEmbed: vi.mocked(ollama.ollamaEmbeddings.embed),
  claudeChat: vi.mocked(claude.claudeAgentChat.answer),
};

beforeEach(() => {
  vi.clearAllMocks();
  env.anthropicApiKey = "";
});

describe("embedTexts chain", () => {
  it("returns empty result for empty input without calling providers", async () => {
    const res = await embedTexts([]);
    expect(res.vectors).toEqual([]);
    expect(res.provider).toBe("noop");
    expect(mocked.ollamaEmbed).not.toHaveBeenCalled();
  });

  it("uses Ollama when reachable", async () => {
    mocked.ollamaAvailable.mockResolvedValue(true);
    mocked.ollamaEmbed.mockResolvedValue([[0.1, 0.2]]);
    const res = await embedTexts(["x"]);
    expect(res.provider).toBe("ollama");
    expect(res.vectors).toEqual([[0.1, 0.2]]);
  });

  it("demotes to mock when Ollama throws", async () => {
    mocked.ollamaAvailable.mockResolvedValue(true);
    mocked.ollamaEmbed.mockRejectedValue(new Error("ollama 500"));
    const res = await embedTexts(["x"]);
    expect(res.provider).toBe("mock");
    expect(res.vectors[0]).toHaveLength(768);
  });

  it("uses mock when Ollama is unreachable", async () => {
    mocked.ollamaAvailable.mockResolvedValue(false);
    const res = await embedTexts(["x"]);
    expect(res.provider).toBe("mock");
    expect(mocked.ollamaEmbed).not.toHaveBeenCalled();
  });
});

describe("answerQuestion chain", () => {
  const input = { question: "what?", contexts: [] };

  it("uses Claude Agent SDK when ANTHROPIC_API_KEY is set", async () => {
    env.anthropicApiKey = "sk-test";
    mocked.claudeChat.mockResolvedValue({ answer: "claude-ans", provider: "claude-agent-sdk", model: "m" });
    const res = await answerQuestion(input);
    expect(res.provider).toBe("claude-agent-sdk");
    expect(mocked.claudeChat).toHaveBeenCalledOnce();
  });

  it("falls back to Ollama when Claude throws", async () => {
    env.anthropicApiKey = "sk-test";
    mocked.claudeChat.mockRejectedValue(new Error("anthropic 429"));
    mocked.ollamaAvailable.mockResolvedValue(true);
    mocked.ollamaChat.mockResolvedValue({ answer: "ollama-ans", provider: "ollama", model: "g" });
    const res = await answerQuestion(input);
    expect(res.provider).toBe("ollama");
  });

  it("falls back to mock when Claude and Ollama both fail", async () => {
    env.anthropicApiKey = "sk-test";
    mocked.claudeChat.mockRejectedValue(new Error("anthropic down"));
    mocked.ollamaAvailable.mockResolvedValue(false);
    const res = await answerQuestion(input);
    expect(res.provider).toBe("mock");
    expect(res.answer).toContain("[DEMO MODE]");
  });

  it("skips Claude when no API key is set", async () => {
    mocked.ollamaAvailable.mockResolvedValue(true);
    mocked.ollamaChat.mockResolvedValue({ answer: "x", provider: "ollama", model: "g" });
    await answerQuestion(input);
    expect(mocked.claudeChat).not.toHaveBeenCalled();
  });
});
