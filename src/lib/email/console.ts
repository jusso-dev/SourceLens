import { randomUUID } from "node:crypto";
import type { EmailProvider } from "./types";

/** Development fallback. Writes the email to stdout so the dev console doubles as
 *  an outbox; never throws. */
export const consoleEmail: EmailProvider = {
  name: "console",
  async send({ to, subject, text }) {
    const id = randomUUID();
    console.log(
      `\n[email:console] id=${id} to=${to}\n  subject: ${subject}\n  ----\n  ${text.replace(/\n/g, "\n  ")}\n`,
    );
    return { id, provider: "console" };
  },
};
