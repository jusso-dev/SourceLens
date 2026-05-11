import { randomUUID } from "node:crypto";
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

export const smtpEmail: EmailProvider = {
  name: "smtp",
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport(getUrl());
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
