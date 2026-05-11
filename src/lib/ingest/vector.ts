import { Prisma } from "@prisma/client";

/** Format a JS number[] as a pgvector text literal: `[0.123,-0.456,...]`. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => Number.isFinite(x) ? x.toFixed(6) : "0").join(",")}]`;
}

/** Inline SQL fragment that casts a vector literal to `vector` for queries. */
export function vectorParam(v: number[]) {
  return Prisma.sql`${toVectorLiteral(v)}::vector`;
}
