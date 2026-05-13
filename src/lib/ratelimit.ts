/**
 * Distributed token-bucket rate limiter backed by Redis.
 *
 * Each (bucket, key) pair gets one bucket. Refill is continuous (tokens are
 * granted in proportion to elapsed time), so a sustained `refillPerSecond`
 * rate translates directly to "N requests per second" with `capacity` bursts.
 *
 * The bucket update runs as a single atomic Lua script — read, refill, decide,
 * and persist all happen in one round-trip with no race. The script is cached
 * via `SCRIPT LOAD`; if Redis evicts it (`NOSCRIPT`) the call re-loads
 * transparently.
 */

import { getRawRedis } from "@/lib/queue";
import { RateLimitError } from "@/lib/errors";
import type { RateResult } from "@/lib/ratelimit-types";

export type { RateResult };

export interface RateBucket {
  /** Maximum tokens the bucket can hold. */
  capacity: number;
  /** Tokens refilled per second. capacity / refillPerSecond ≈ full-bucket recovery time. */
  refillPerSecond: number;
  /** Tokens consumed per request. Defaults to 1. */
  cost?: number;
}

// KEYS[1] = bucket key
// ARGV    = [capacity, refillPerMs, now(ms), cost]
const LUA = `
local key  = KEYS[1]
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now  = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local data   = redis.call("HMGET", key, "t", "ts")
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])
if tokens == nil then tokens = cap end
if ts == nil then ts = now end

local delta = math.max(0, now - ts)
tokens = math.min(cap, tokens + delta * rate)

local allowed = 0
local retryMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryMs = math.ceil((cost - tokens) / rate)
end

redis.call("HSET", key, "t", tokens, "ts", now)
redis.call("PEXPIRE", key, math.ceil(cap / rate) * 1000 + 5000)
return { allowed, math.floor(tokens), retryMs }
`;

let sha: string | null = null;
async function ensureScript(): Promise<string> {
  if (sha) return sha;
  const r = getRawRedis();
  sha = (await r.script("LOAD", LUA)) as string;
  return sha;
}

function validateBucket(bucket: RateBucket): void {
  if (!Number.isFinite(bucket.capacity) || bucket.capacity <= 0) {
    throw new Error(`Rate bucket capacity must be > 0 (got ${bucket.capacity})`);
  }
  if (!Number.isFinite(bucket.refillPerSecond) || bucket.refillPerSecond <= 0) {
    throw new Error(`Rate bucket refillPerSecond must be > 0 (got ${bucket.refillPerSecond})`);
  }
  if (bucket.cost !== undefined && (!Number.isFinite(bucket.cost) || bucket.cost <= 0)) {
    throw new Error(`Rate bucket cost must be > 0 when set (got ${bucket.cost})`);
  }
}

export async function consumeRate(key: string, bucket: RateBucket): Promise<RateResult> {
  validateBucket(bucket);
  const cost = bucket.cost ?? 1;
  const refillPerMs = bucket.refillPerSecond / 1000;
  const now = Date.now();
  const redis = getRawRedis();

  const run = async (): Promise<[number, number, number]> => {
    const s = await ensureScript();
    return (await redis.evalsha(s, 1, key, bucket.capacity, refillPerMs, now, cost)) as [
      number,
      number,
      number,
    ];
  };

  let result: [number, number, number];
  try {
    result = await run();
  } catch (err) {
    if (err instanceof Error && err.message.includes("NOSCRIPT")) {
      sha = null;
      result = await run();
    } else {
      throw err;
    }
  }

  const [allowed, remaining, retryMs] = result;
  return {
    allowed: allowed === 1,
    remaining,
    limit: bucket.capacity,
    retryAfterSeconds: Math.ceil(retryMs / 1000),
    resetSeconds: Math.ceil((bucket.capacity - remaining) / bucket.refillPerSecond),
  };
}

export function rateLimitHeaders(r: RateResult): Record<string, string> {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(Math.max(0, r.remaining)),
    "X-RateLimit-Reset": String(r.resetSeconds),
  };
  if (!r.allowed) h["Retry-After"] = String(Math.max(1, r.retryAfterSeconds));
  return h;
}

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-route, per-user buckets. Capacity is the burst; refill is the sustained rate. */
export const BUCKETS = {
  upload: {
    capacity: numEnv("RATE_LIMIT_UPLOAD_BURST", 5),
    refillPerSecond: numEnv("RATE_LIMIT_UPLOAD_PER_HOUR", 30) / 3600,
  },
  search: {
    capacity: numEnv("RATE_LIMIT_SEARCH_BURST", 60),
    refillPerSecond: numEnv("RATE_LIMIT_SEARCH_PER_MINUTE", 60) / 60,
  },
  ask: {
    capacity: numEnv("RATE_LIMIT_ASK_BURST", 20),
    refillPerSecond: numEnv("RATE_LIMIT_ASK_PER_MINUTE", 20) / 60,
  },
  retry: {
    capacity: numEnv("RATE_LIMIT_RETRY_BURST", 10),
    refillPerSecond: numEnv("RATE_LIMIT_RETRY_PER_MINUTE", 10) / 60,
  },
} satisfies Record<string, RateBucket>;

export type BucketName = keyof typeof BUCKETS;

/** IP-keyed anonymous buckets for unauthenticated endpoints (sign-in, sign-up,
 *  password reset, email verification resend, public invitation lookup). */
export const ANON_BUCKETS = {
  signIn: {
    capacity: numEnv("RATE_LIMIT_ANON_SIGNIN_BURST", 5),
    refillPerSecond: numEnv("RATE_LIMIT_ANON_SIGNIN_PER_HOUR", 30) / 3600,
  },
  signUp: {
    capacity: numEnv("RATE_LIMIT_ANON_SIGNUP_BURST", 3),
    refillPerSecond: numEnv("RATE_LIMIT_ANON_SIGNUP_PER_HOUR", 10) / 3600,
  },
  inviteLookup: {
    capacity: numEnv("RATE_LIMIT_ANON_INVITE_BURST", 30),
    refillPerSecond: numEnv("RATE_LIMIT_ANON_INVITE_PER_HOUR", 120) / 3600,
  },
  passwordReset: {
    capacity: numEnv("RATE_LIMIT_ANON_RESET_BURST", 3),
    refillPerSecond: numEnv("RATE_LIMIT_ANON_RESET_PER_HOUR", 10) / 3600,
  },
  verifyResend: {
    capacity: numEnv("RATE_LIMIT_ANON_VERIFY_BURST", 3),
    refillPerSecond: numEnv("RATE_LIMIT_ANON_VERIFY_PER_HOUR", 6) / 3600,
  },
} satisfies Record<string, RateBucket>;

export type AnonBucketName = keyof typeof ANON_BUCKETS;

/** Convenience: enforce a bucket for a (user, route) pair, throwing on block. */
export async function enforceRateLimit(bucket: BucketName, userId: string): Promise<RateResult> {
  const result = await consumeRate(`rl:${bucket}:u:${userId}`, BUCKETS[bucket]);
  if (!result.allowed) throw new RateLimitError(result);
  return result;
}

/** Same as `enforceRateLimit` but keyed on the caller IP. */
export async function enforceAnonRateLimit(
  bucket: AnonBucketName,
  ip: string,
): Promise<RateResult> {
  const result = await consumeRate(`rl:anon:${bucket}:ip:${ip}`, ANON_BUCKETS[bucket]);
  if (!result.allowed) throw new RateLimitError(result);
  return result;
}

/** Resolve the client IP from a Web `Request`. Honours `X-Forwarded-For` and
 *  `Forwarded` only when `TRUST_PROXY` is truthy — otherwise an attacker can
 *  spoof their identity by sending the header. */
export function getClientIp(req: Request): string {
  const trust = (process.env.TRUST_PROXY ?? "").toLowerCase();
  const trustProxy = trust === "1" || trust === "true" || trust === "yes";

  if (trustProxy) {
    const fwd = req.headers.get("forwarded");
    if (fwd) {
      const m = fwd.match(/for=("?\[?)([^;,"\]\s]+)/i);
      if (m) return normaliseIp(m[2]);
    }
    const xff = req.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return normaliseIp(first);
    }
    const xri = req.headers.get("x-real-ip");
    if (xri) return normaliseIp(xri.trim());
  }

  // Fallback when proxy not trusted. Better-auth and other endpoints will
  // share one bucket; this is the safe default for spoofing-prone setups.
  return "unknown";
}

function normaliseIp(raw: string): string {
  // Strip IPv6 zone and brackets, lower-case for stable bucket keying.
  return raw.replace(/^\[/, "").replace(/\]$/, "").split("%")[0].toLowerCase();
}
