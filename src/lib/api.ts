import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/server";
import { rateLimitHeaders, type RateResult } from "@/lib/ratelimit";

export type JsonResponse<T> = NextResponse<T | { error: string; details?: unknown }>;

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export class RateLimitError extends Error {
  constructor(public rate: RateResult) {
    super("Rate limit exceeded");
  }
}

export function jsonError(status: number, error: string, details?: unknown, headers?: Record<string, string>) {
  return NextResponse.json({ error, details }, { status, headers });
}

export async function withApi<T>(fn: () => Promise<T>): Promise<JsonResponse<T>> {
  try {
    const data = await fn();
    return NextResponse.json(data) as JsonResponse<T>;
  } catch (err) {
    if (err instanceof RateLimitError) {
      return jsonError(
        429,
        err.message,
        { retryAfterSeconds: err.rate.retryAfterSeconds, limit: err.rate.limit },
        rateLimitHeaders(err.rate),
      ) as JsonResponse<T>;
    }
    if (err instanceof ApiError) return jsonError(err.status, err.message, err.details) as JsonResponse<T>;
    if (err instanceof UnauthorizedError) return jsonError(401, err.message) as JsonResponse<T>;
    if (err instanceof ForbiddenError) return jsonError(403, err.message) as JsonResponse<T>;
    if (err instanceof ZodError) return jsonError(400, "Invalid request", err.flatten()) as JsonResponse<T>;
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("[api]", err);
    return jsonError(500, message) as JsonResponse<T>;
  }
}
