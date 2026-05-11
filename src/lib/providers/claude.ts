import { env } from "@/lib/env";
import type { ChatInput, ChatProvider, ChatResult, StreamEvent } from "./types";
import { defaultSystemPrompt, formatContexts } from "./ollama";

function buildPrompt(input: ChatInput): string {
  return `${formatContexts(input.contexts)}\n\nQuestion: ${input.question}`;
}

async function runQuery(input: ChatInput) {
  if (!env.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  return query({
    prompt: buildPrompt(input),
    options: {
      model: env.anthropicModel,
      systemPrompt: input.systemPrompt ?? defaultSystemPrompt(),
      maxTurns: 1,
      allowedTools: [],
      permissionMode: "bypassPermissions",
      env: { ...process.env, ANTHROPIC_API_KEY: env.anthropicApiKey },
    } as Record<string, unknown>,
  } as Parameters<typeof query>[0]) as AsyncIterable<Record<string, unknown>>;
}

/** Claude chat via the Anthropic Claude Agent SDK.
 *  The SDK is loaded lazily so a missing binary / missing API key surfaces at call time
 *  and lets the higher-level chain demote to Ollama/mock. */
export const claudeAgentChat: ChatProvider = {
  name: "claude-agent-sdk",
  model: env.anthropicModel,
  async answer(input: ChatInput): Promise<ChatResult> {
    const iter = await runQuery(input);
    let answer = "";
    for await (const msg of iter) {
      const type = msg.type as string;
      if (type === "assistant") {
        const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) answer += block.text;
          }
        }
      } else if (type === "result") {
        const r = msg as { subtype?: string; result?: string };
        if (r.subtype === "success" && r.result) answer = r.result;
      }
    }
    return { answer: answer.trim(), provider: "claude-agent-sdk", model: env.anthropicModel };
  },
  async *stream(input: ChatInput): AsyncGenerator<StreamEvent> {
    const iter = await runQuery(input);
    let answer = "";
    for await (const msg of iter) {
      const type = msg.type as string;
      if (type === "assistant") {
        const message = msg.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        const content = message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              answer += block.text;
              yield { type: "delta", text: block.text };
            }
          }
        }
      } else if (type === "result") {
        const r = msg as { subtype?: string; result?: string };
        if (r.subtype === "success" && r.result) answer = r.result;
      }
    }
    yield {
      type: "done",
      result: { answer: answer.trim(), provider: "claude-agent-sdk", model: env.anthropicModel },
    };
  },
};
