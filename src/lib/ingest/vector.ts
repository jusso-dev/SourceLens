/** Format a JS number[] as a pgvector text literal: `[0.123,-0.456,...]`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => Number.isFinite(x) ? x.toFixed(6) : "0").join(",")}]`;
}
