import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_BACKOFF_DELAY_MS,
  WEBHOOK_DISABLE_AFTER_FAILURES,
  WEBHOOK_MAX_ATTEMPTS,
} from "@/lib/webhooks/config";
import { signWebhookPayload } from "@/lib/webhooks/signing";

describe("webhook signing", () => {
  it("computes the SourceLens HMAC header", () => {
    const expected = createHmac("sha256", "secret").update('{"ok":true}').digest("hex");
    expect(signWebhookPayload("secret", '{"ok":true}')).toBe(`sha256=${expected}`);
  });
});

describe("webhook retry policy", () => {
  it("matches the documented delivery policy", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(5);
    expect(WEBHOOK_BACKOFF_DELAY_MS).toBe(5_000);
    expect(WEBHOOK_DISABLE_AFTER_FAILURES).toBe(20);
  });
});
