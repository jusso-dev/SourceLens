/**
 * HTTP/JSON helpers for App Router handlers.
 *
 * `withApi` is the single entry point for every JSON route. It runs the
 * handler, normalises every known error class into a structured response,
 * and — crucially — refuses to leak unhandled `Error.message` strings in
 * production (those frequently contain stack traces, SQL fragments, or
 * provider error bodies).
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ApiError,
  ForbiddenError,
  RateLimitError,
  UnauthorizedError,
} from "@/lib/errors";
import { env } from "@/lib/env";
import { rateLimitHeaders } from "@/lib/ratelimit";

export { ApiError, ForbiddenError, RateLimitError, UnauthorizedError };

export type JsonErrorBody = { error: string; details?: unknown };
export type JsonResponse<T> = NextResponse<T | JsonErrorBody>;

export function jsonError(
  status: number,
  error: string,
  details?: unknown,
  headers?: Record<string, string>,
): NextResponse<JsonErrorBody> {
  const body: JsonErrorBody = details === undefined ? { error } : { error, details };
  return NextResponse.json(body, { status, headers });
}

export async function withApi<T>(fn: () => Promise<T>): Promise<JsonResponse<T>> {
  try {
    const data = await fn();
    return NextResponse.json(data) as JsonResponse<T>;
  } catch (err) {
    return mapErrorToResponse(err) as JsonResponse<T>;
  }
}

/** Map any thrown value into the appropriate JSON response. Exposed so
 *  non-JSON handlers (SSE, multipart) can share the same translation. */
export function mapErrorToResponse(err: unknown): NextResponse<JsonErrorBody> {
  if (err instanceof RateLimitError) {
    return jsonError(
      429,
      err.message,
      { retryAfterSeconds: err.rate.retryAfterSeconds, limit: err.rate.limit },
      rateLimitHeaders(err.rate),
    );
  }
  if (err instanceof ApiError) return jsonError(err.status, err.message, err.details);
  if (err instanceof UnauthorizedError) return jsonError(401, err.message);
  if (err instanceof ForbiddenError) return jsonError(403, err.message);
  if (err instanceof ZodError) return jsonError(400, "Invalid request", err.flatten());

  // Anything else is an unhandled bug. Log the full error server-side, but
  // never bleed the message back to the client in production — it may contain
  // SQL, file paths, or upstream provider error bodies.
  console.error("[api] unhandled error:", err);
  const message = env.isProduction
    ? "Internal server error"
    : err instanceof Error
      ? err.message
      : "Internal error";
  return jsonError(500, message);
}
