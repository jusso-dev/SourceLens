import { getRawRedis } from "@/lib/queue";

/** Token-bucket rate limit backed by Redis. Atomic via a single Lua script. */

export interface RateBucket {
  /** Maximum tokens the bucket can hold. */
  capacity: number;
  /** Tokens refilled per second. capacity / refillPerSecond ≈ full-bucket recovery time. */
  refillPerSecond: number;
  /** Tokens consumed per request. Defaults to 1. */
  cost?: number;
}

export interface RateResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
  resetSeconds: number;
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

redis.call("HMSET", key, "t", tokens, "ts", now)
redis.call("PEXPIRE", key, math.ceil(cap / rate) * 1000 + 5000)
return { allowed, math.floor(tokens), retryMs }
`;

let sha: string | null = null;
async function ensureScript(): Promise<string> {
  if (sha) return sha;
  const r = getRawRedis();
  sha = await r.script("LOAD", LUA) as string;
  return sha;
}

export async function consumeRate(key: string, bucket: RateBucket): Promise<RateResult> {
  const cost = bucket.cost ?? 1;
  const refillPerMs = bucket.refillPerSecond / 1000;
  const now = Date.now();
  const redis = getRawRedis();

  let result: [number, number, number];
  try {
    const s = await ensureScript();
    result = (await redis.evalsha(s, 1, key, bucket.capacity, refillPerMs, now, cost)) as [
      number,
      number,
      number,
    ];
  } catch (err) {
    if (err instanceof Error && err.message.includes("NOSCRIPT")) {
      sha = null;
      const s = await ensureScript();
      result = (await redis.evalsha(s, 1, key, bucket.capacity, refillPerMs, now, cost)) as [
        number,
        number,
        number,
      ];
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
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

/** Convenience: enforce a bucket for a (user, route) pair, throwing on block. */
export async function enforceRateLimit(bucket: BucketName, userId: string): Promise<RateResult> {
  const result = await consumeRate(`rl:${bucket}:u:${userId}`, BUCKETS[bucket]);
  if (!result.allowed) {
    const { RateLimitError } = await import("@/lib/api");
    throw new RateLimitError(result);
  }
  return result;
}
