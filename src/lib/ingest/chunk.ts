/** Character-window chunker with paragraph-aware boundaries and configurable overlap.
 *  Approximate target: ~500 tokens ≈ 2000 chars; overlap 200 chars. Boundary search
 *  prefers paragraph breaks, then sentences, then whitespace. */

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
  minChars?: number;
}

export interface Chunk {
  index: number;
  text: string;
  charCount: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetChars ?? 2000;
  const overlap = Math.min(opts.overlapChars ?? 200, target - 50);
  const minChars = opts.minChars ?? 100;
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= target) {
    return [{ index: 0, text: trimmed, charCount: trimmed.length }];
  }

  const chunks: Chunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + target, trimmed.length);
    if (end < trimmed.length) {
      end = findBoundary(trimmed, start, end);
    }
    const slice = trimmed.slice(start, end).trim();
    if (slice.length >= minChars || start === 0) {
      chunks.push({ index: idx++, text: slice, charCount: slice.length });
    } else if (chunks.length > 0) {
      // Tail too small — merge into previous.
      const prev = chunks[chunks.length - 1];
      prev.text = `${prev.text} ${slice}`.trim();
      prev.charCount = prev.text.length;
    }
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function findBoundary(text: string, start: number, end: number): number {
  const window = Math.min(end - start, 400);
  const lookFrom = Math.max(start, end - window);
  const slice = text.slice(lookFrom, end);
  const paragraph = slice.lastIndexOf("\n\n");
  if (paragraph !== -1 && paragraph > 50) return lookFrom + paragraph;
  const sentence = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf(".\n"),
  );
  if (sentence !== -1 && sentence > 50) return lookFrom + sentence + 1;
  const space = slice.lastIndexOf(" ");
  if (space !== -1 && space > 50) return lookFrom + space;
  return end;
}
