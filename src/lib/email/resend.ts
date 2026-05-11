import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

function getFrom(): string {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM must be set when EMAIL_PROVIDER=resend");
  return from;
}

function getApiKey(): string {
  const k = process.env.RESEND_API_KEY;
  if (!k) throw new Error("RESEND_API_KEY must be set when EMAIL_PROVIDER=resend");
  return k;
}

export const resendEmail: EmailProvider = {
  name: "resend",
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const { Resend } = await import("resend");
    const client = new Resend(getApiKey());
    const result = await client.emails.send({
      from: getFrom(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      tags: msg.tags
        ? Object.entries(msg.tags).map(([name, value]) => ({ name, value }))
        : undefined,
    });
    if (result.error) {
      throw new Error(`resend send failed: ${result.error.message ?? result.error.name}`);
    }
    return { id: result.data?.id ?? "resend-unknown", provider: "resend" };
  },
};
