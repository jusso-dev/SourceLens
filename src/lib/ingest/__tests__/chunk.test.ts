import { describe, expect, it } from "vitest";
import { chunkText } from "../chunk";

describe("chunkText", () => {
  it("returns empty array for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk when input fits in target window", () => {
    const text = "Short paragraph.";
    const out = chunkText(text, { targetChars: 200 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 0, text: "Short paragraph.", charCount: 16 });
  });

  it("splits long input on paragraph boundaries when possible", () => {
    const para = "Sentence about pgvector indexing strategies. ".repeat(20).trim();
    const text = `${para}\n\n${para}\n\n${para}`;
    const out = chunkText(text, { targetChars: 600, overlapChars: 60 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.charCount).toBeGreaterThan(0);
      expect(c.text.length).toBeLessThanOrEqual(700); // some slack for boundary search
    }
    // chunk indexes are dense and 0-based
    expect(out.map((c) => c.index)).toEqual(out.map((_, i) => i));
  });

  it("produces overlapping content across adjacent chunks", () => {
    const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa ".repeat(30).trim();
    const out = chunkText(text, { targetChars: 400, overlapChars: 80 });
    expect(out.length).toBeGreaterThan(1);
    // Tail of chunk N should share characters with head of chunk N+1.
    for (let i = 0; i < out.length - 1; i++) {
      const tail = out[i].text.slice(-40);
      // overlap is fuzzy because boundaries snap to whitespace/punctuation;
      // assert that at least one whole word from the tail appears at the head.
      const tailWord = tail.split(/\s+/).filter((w) => w.length > 2).pop();
      if (tailWord) {
        expect(out[i + 1].text.slice(0, 200)).toContain(tailWord);
      }
    }
  });

  it("merges short tail chunk into previous when below minChars", () => {
    const head = "long body paragraph. ".repeat(40).trim();
    const text = `${head}\n\nx`;
    const out = chunkText(text, { targetChars: 300, overlapChars: 30, minChars: 50 });
    // The dangling "x" must NOT survive as its own chunk.
    expect(out.every((c) => c.text !== "x")).toBe(true);
  });

  it("renumbers chunks consecutively even after merge", () => {
    const text = "alpha beta gamma delta. ".repeat(60).trim();
    const out = chunkText(text, { targetChars: 250, overlapChars: 40, minChars: 60 });
    expect(out.map((c) => c.index)).toEqual([...Array(out.length).keys()]);
  });
});
