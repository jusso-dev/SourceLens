import { randomUUID } from "node:crypto";
import type { Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

function getFrom(): string {
  const from = process.env.SMTP_FROM ?? process.env.EMAIL_FROM;
  if (!from) throw new Error("SMTP_FROM or EMAIL_FROM must be set when EMAIL_PROVIDER=smtp");
  return from;
}

function getUrl(): string {
  const url = process.env.SMTP_URL;
  if (!url) throw new Error("SMTP_URL must be set when EMAIL_PROVIDER=smtp");
  return url;
}

/** Cached transporter keyed by URL so a config change in long-running tests
 *  rebuilds the underlying pool rather than reusing a stale connection. */
let cached: { url: string; transport: Transporter } | null = null;

async function getTransport(): Promise<Transporter> {
  const url = getUrl();
  if (cached && cached.url === url) return cached.transport;
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(url);
  cached = { url, transport };
  return transport;
}

export const smtpEmail: EmailProvider = {
  name: "smtp",
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const transporter = await getTransport();
    const info = await transporter.sendMail({
      from: getFrom(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.tags
        ? Object.fromEntries(Object.entries(msg.tags).map(([k, v]) => [`X-Tag-${k}`, v]))
        : undefined,
    });
    return { id: info.messageId ?? `smtp-${randomUUID()}`, provider: "smtp" };
  },
};
