import { describe, expect, it } from "vitest";
import { searchSchema } from "@/app/api/search/route";
import { askSchema } from "@/app/api/ask/route";
import { reciprocalRankFusion } from "@/lib/search";

describe("searchSchema", () => {
  it("rejects empty query", () => {
    const r = searchSchema.safeParse({ query: "" });
    expect(r.success).toBe(false);
  });

  it("rejects oversize query", () => {
    const r = searchSchema.safeParse({ query: "x".repeat(2001) });
    expect(r.success).toBe(false);
  });

  it("defaults mode to hybrid", () => {
    const r = searchSchema.safeParse({ query: "hello" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mode).toBe("hybrid");
  });

  it("rejects unknown mode", () => {
    const r = searchSchema.safeParse({ query: "hi", mode: "fuzzy" });
    expect(r.success).toBe(false);
  });

  it("accepts documentIds and fileTypes arrays", () => {
    const r = searchSchema.safeParse({
      query: "hi",
      documentIds: ["doc_1", "doc_2"],
      fileTypes: ["pdf"],
      limit: 5,
    });
    expect(r.success).toBe(true);
  });

  it("rejects limit out of range", () => {
    expect(searchSchema.safeParse({ query: "x", limit: 0 }).success).toBe(false);
    expect(searchSchema.safeParse({ query: "x", limit: 999 }).success).toBe(false);
  });
});

describe("askSchema", () => {
  it("requires a question of at least 3 chars", () => {
    expect(askSchema.safeParse({ question: "hi" }).success).toBe(false);
    expect(askSchema.safeParse({ question: "hi?" }).success).toBe(true);
  });
  it("clamps topK range", () => {
    expect(askSchema.safeParse({ question: "what?", topK: 0 }).success).toBe(false);
    expect(askSchema.safeParse({ question: "what?", topK: 21 }).success).toBe(false);
    expect(askSchema.safeParse({ question: "what?", topK: 6 }).success).toBe(true);
  });
});

describe("reciprocalRankFusion", () => {
  const make = (id: string, src: "keyword" | "vector") =>
    ({
      chunkId: id,
      documentId: "d",
      filename: "f",
      fileType: "md",
      chunkIndex: 0,
      text: "",
      score: 0,
      source: src,
    }) as const;

  it("ranks an item appearing in both lists above singleton appearances", () => {
    const a = [make("x", "keyword"), make("y", "keyword"), make("z", "keyword")];
    const b = [make("x", "vector"), make("w", "vector")];
    const fused = reciprocalRankFusion(a, b);
    expect(fused[0].chunkId).toBe("x");
  });

  it("preserves all unique items", () => {
    const a = [make("a", "keyword"), make("b", "keyword")];
    const b = [make("c", "vector"), make("d", "vector")];
    const fused = reciprocalRankFusion(a, b);
    expect(fused.map((h) => h.chunkId).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns empty list when both inputs are empty", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });
});
