import { describe, expect, it, vi, beforeEach } from "vitest";

// Build an in-memory Redis stub that supports the script + evalsha API used by
// `consumeRate`. We only need to honour the same Lua semantics on a per-key basis.

interface Bucket {
  t: number;
  ts: number;
}

class FakeRedis {
  private state = new Map<string, Bucket>();
  private now: number;
  constructor(initialNow = 0) {
    this.now = initialNow;
  }
  setTime(ms: number) {
    this.now = ms;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async script(...args: unknown[]) {
    return "fake-sha";
  }
  async evalsha(
    _sha: string,
    _keyCount: number,
    key: string,
    capStr: string | number,
    rateStr: string | number,
    nowStr: string | number,
    costStr: string | number,
  ): Promise<[number, number, number]> {
    const cap = Number(capStr);
    const rate = Number(rateStr);
    const now = Number(nowStr);
    const cost = Number(costStr);

    let bucket = this.state.get(key);
    if (!bucket) bucket = { t: cap, ts: now };

    const delta = Math.max(0, now - bucket.ts);
    let tokens = Math.min(cap, bucket.t + delta * rate);
    let allowed = 0;
    let retry = 0;
    if (tokens >= cost) {
      tokens -= cost;
      allowed = 1;
    } else {
      retry = Math.ceil((cost - tokens) / rate);
    }
    this.state.set(key, { t: tokens, ts: now });
    return [allowed, Math.floor(tokens), retry];
  }
}

const fake = new FakeRedis();

vi.mock("@/lib/queue", () => ({
  getRawRedis: () => fake,
}));

const realDateNow = Date.now;
beforeEach(() => {
  // reset module state between tests
  vi.resetModules();
  Date.now = realDateNow;
});

describe("consumeRate (token bucket)", () => {
  it("allows up to capacity in a burst, then denies", async () => {
    const { consumeRate } = await import("../ratelimit");
    Date.now = () => 1_000_000;
    const bucket = { capacity: 3, refillPerSecond: 0.1 };
    const key = "rl:test:burst";

    const a = await consumeRate(key, bucket);
    const b = await consumeRate(key, bucket);
    const c = await consumeRate(key, bucket);
    const d = await consumeRate(key, bucket);

    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
    expect(d.limit).toBe(3);
  });

  it("refills tokens over time at the configured rate", async () => {
    const { consumeRate } = await import("../ratelimit");
    let now = 2_000_000;
    Date.now = () => now;
    const bucket = { capacity: 2, refillPerSecond: 1 }; // 1 token per second
    const key = "rl:test:refill";

    // drain
    await consumeRate(key, bucket);
    await consumeRate(key, bucket);
    const drained = await consumeRate(key, bucket);
    expect(drained.allowed).toBe(false);

    // advance 1100 ms → at least one token regenerated
    now += 1100;
    const after = await consumeRate(key, bucket);
    expect(after.allowed).toBe(true);
  });
});

describe("rateLimitHeaders", () => {
  it("includes Retry-After only when blocked", async () => {
    const { rateLimitHeaders } = await import("../ratelimit");
    const allowed = rateLimitHeaders({
      allowed: true,
      remaining: 3,
      limit: 5,
      retryAfterSeconds: 0,
      resetSeconds: 10,
    });
    expect(allowed["Retry-After"]).toBeUndefined();
    expect(allowed["X-RateLimit-Limit"]).toBe("5");

    const blocked = rateLimitHeaders({
      allowed: false,
      remaining: 0,
      limit: 5,
      retryAfterSeconds: 8,
      resetSeconds: 10,
    });
    expect(blocked["Retry-After"]).toBe("8");
  });
});
