import { describe, expect, it } from "vitest";
import { mockChat, mockEmbeddings } from "../mock";

describe("mockEmbeddings", () => {
  it("produces vectors of the configured dim", async () => {
    const [v] = await mockEmbeddings.embed(["hello"]);
    expect(v).toHaveLength(768);
  });

  it("is deterministic — same input yields identical vector", async () => {
    const [a] = await mockEmbeddings.embed(["the quick brown fox"]);
    const [b] = await mockEmbeddings.embed(["the quick brown fox"]);
    expect(a).toEqual(b);
  });

  it("returns L2-normalised vectors (||v|| ≈ 1)", async () => {
    const [v] = await mockEmbeddings.embed(["normalise me"]);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("different inputs produce different vectors", async () => {
    const [a, b] = await mockEmbeddings.embed(["alpha", "beta"]);
    expect(a).not.toEqual(b);
  });
});

describe("mockChat", () => {
  it("labels mock answers with DEMO MODE", async () => {
    const res = await mockChat.answer({ question: "what is pgvector?", contexts: [] });
    expect(res.answer).toContain("[DEMO MODE]");
    expect(res.provider).toBe("mock");
    expect(res.model).toBe("mock-rag");
  });

  it("includes top contexts in the placeholder body", async () => {
    const res = await mockChat.answer({
      question: "tell me",
      contexts: [
        { id: "c1", documentId: "d1", filename: "alpha.md", chunkIndex: 0, text: "alpha alpha alpha alpha alpha alpha", score: 0.9 },
        { id: "c2", documentId: "d2", filename: "beta.md", chunkIndex: 1, text: "beta beta", score: 0.8 },
      ],
    });
    expect(res.answer).toContain("alpha.md");
    expect(res.answer).toContain("beta.md");
  });

  it("explains the no-context case", async () => {
    const res = await mockChat.answer({ question: "anything?", contexts: [] });
    expect(res.answer).toMatch(/no relevant context/i);
  });
});
