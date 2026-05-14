import { createHmac } from "node:crypto";

export function signWebhookPayload(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}
