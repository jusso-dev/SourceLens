/**
 * Domain error classes shared across the app + worker.
 *
 * Kept in a small, dependency-free module so it can be imported from anywhere
 * (ratelimit, auth, API handlers, providers) without creating import cycles.
 * Anything that depends on Next.js, Prisma, or Redis lives elsewhere.
 */

import type { RateResult } from "@/lib/ratelimit-types";

/** Generic API error with an HTTP status. Use for application-level failures
 *  that the client should see (404, 409, 415, 422, etc.). */
export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** Thrown by the rate limiter; carries the consumed `RateResult` so the
 *  handler can emit `Retry-After` / `X-RateLimit-*` headers. */
export class RateLimitError extends Error {
  readonly rate: RateResult;
  constructor(rate: RateResult) {
    super("Rate limit exceeded");
    this.name = "RateLimitError";
    this.rate = rate;
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}
