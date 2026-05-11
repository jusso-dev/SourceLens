import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

const outbox: Array<EmailMessage & { id: string }> = [];

/** In-memory provider for tests. The test grabs the outbox via `getOutbox()`
 *  to assert what would have been delivered. */
export const mockEmail: EmailProvider = {
  name: "mock",
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const id = randomUUID();
    outbox.push({ ...msg, id });
    return { id, provider: "mock" };
  },
};

export function getOutbox(): ReadonlyArray<EmailMessage & { id: string }> {
  return outbox;
}

export function clearOutbox(): void {
  outbox.length = 0;
}
