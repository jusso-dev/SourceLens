import { env } from "@/lib/env";
import type { ChatInput, ChatProvider, ChatResult } from "./types";
import { defaultSystemPrompt, formatContexts } from "./ollama";

/** Claude chat via the Anthropic Claude Agent SDK.
 *  The SDK is loaded lazily so a missing binary / missing API key surfaces at call time
 *  and lets the higher-level chain demote to Ollama/mock. */
export const claudeAgentChat: ChatProvider = {
  name: "claude-agent-sdk",
  model: env.anthropicModel,
  async answer(input: ChatInput): Promise<ChatResult> {
    if (!env.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const prompt = `${formatContexts(input.contexts)}\n\nQuestion: ${input.question}`;
    const result = query({
      prompt,
      options: {
        model: env.anthropicModel,
        systemPrompt: input.systemPrompt ?? defaultSystemPrompt(),
        maxTurns: 1,
        allowedTools: [],
        permissionMode: "bypassPermissions",
        env: { ...process.env, ANTHROPIC_API_KEY: env.anthropicApiKey },
      } as Record<string, unknown>,
    } as Parameters<typeof query>[0]);

    let answer = "";
    for await (const msg of result as AsyncIterable<Record<string, unknown>>) {
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
    return {
      answer: answer.trim(),
      provider: "claude-agent-sdk",
      model: env.anthropicModel,
    };
  },
};
