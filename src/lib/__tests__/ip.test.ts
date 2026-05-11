import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIG = process.env.TRUST_PROXY;

beforeEach(() => {
  delete process.env.TRUST_PROXY;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = ORIG;
});

async function load() {
  return (await import("../ratelimit")).getClientIp;
}

function req(headers: Record<string, string>) {
  return new Request("http://localhost/x", { headers });
}

describe("getClientIp", () => {
  it("returns 'unknown' when TRUST_PROXY is off, regardless of headers", async () => {
    const getClientIp = await load();
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
    expect(getClientIp(req({ forwarded: "for=5.6.7.8" }))).toBe("unknown");
  });

  it("honours X-Forwarded-For when TRUST_PROXY=1", async () => {
    process.env.TRUST_PROXY = "1";
    const getClientIp = await load();
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("returns the FIRST address in a multi-hop XFF", async () => {
    process.env.TRUST_PROXY = "true";
    const getClientIp = await load();
    expect(
      getClientIp(req({ "x-forwarded-for": "203.0.113.5, 198.51.100.10, 10.0.0.1" })),
    ).toBe("203.0.113.5");
  });

  it("prefers `Forwarded` over `X-Forwarded-For`", async () => {
    process.env.TRUST_PROXY = "1";
    const getClientIp = await load();
    expect(
      getClientIp(
        req({ forwarded: "for=192.0.2.7;proto=https", "x-forwarded-for": "10.0.0.1" }),
      ),
    ).toBe("192.0.2.7");
  });

  it("strips IPv6 brackets and zone identifier", async () => {
    process.env.TRUST_PROXY = "1";
    const getClientIp = await load();
    expect(
      getClientIp(req({ forwarded: 'for="[2001:db8::1%eth0]";proto=https' })),
    ).toBe("2001:db8::1");
  });

  it("falls through to X-Real-IP when neither XFF nor Forwarded is present", async () => {
    process.env.TRUST_PROXY = "1";
    const getClientIp = await load();
    expect(getClientIp(req({ "x-real-ip": "198.51.100.42" }))).toBe("198.51.100.42");
  });

  it("returns 'unknown' for X-Real-IP when TRUST_PROXY is off", async () => {
    const getClientIp = await load();
    expect(getClientIp(req({ "x-real-ip": "198.51.100.42" }))).toBe("unknown");
  });
});
