import { describe, expect, it } from "vitest";
import { noopReranker } from "../noop";

describe("noopReranker", () => {
  it("preserves candidate order and keeps existing scores", async () => {
    const scores = await noopReranker.rerank("capital city", [
      { chunkId: "a", text: "first", score: 0.4 },
      { chunkId: "b", text: "second", score: 0.2 },
    ]);

    expect(scores).toEqual([
      { chunkId: "a", score: 0.4 },
      { chunkId: "b", score: 0.2 },
    ]);
  });
});
