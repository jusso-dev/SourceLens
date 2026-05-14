import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_TOKEN_SCOPES,
  hashApiTokenSecret,
  issueApiToken,
  normaliseScopes,
  parseApiToken,
  verifyApiTokenSecret,
} from "@/lib/api-tokens";

describe("api token helpers", () => {
  it("issues parseable tokens and stores only a hashable secret", () => {
    const issued = issueApiToken();
    const parsed = parseApiToken(issued.token);
    expect(parsed).toEqual({ prefix: issued.prefix, secret: issued.secret });
    expect(issued.token).toContain(`sl_${issued.prefix}_`);
    expect(issued.hashedSecret).toBe(hashApiTokenSecret(issued.secret));
    expect(verifyApiTokenSecret(issued.secret, issued.hashedSecret)).toBe(true);
    expect(verifyApiTokenSecret(`${issued.secret}x`, issued.hashedSecret)).toBe(false);
  });

  it("rejects malformed token strings", () => {
    expect(parseApiToken("")).toBeNull();
    expect(parseApiToken("sl_only-two-parts")).toBeNull();
    expect(parseApiToken("xx_prefix_secret")).toBeNull();
  });

  it("normalises scopes to the allowed unique set", () => {
    expect(normaliseScopes(["ask", "ask", "admin", "bad"])).toEqual(["ask", "admin"]);
    expect(normaliseScopes(null)).toEqual(DEFAULT_API_TOKEN_SCOPES);
  });
});
