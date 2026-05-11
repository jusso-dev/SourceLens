import { consoleEmail } from "./console";
import { mockEmail } from "./mock";
import { resendEmail } from "./resend";
import { smtpEmail } from "./smtp";
import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

let cached: EmailProvider | null = null;
let cachedKey: string | null = null;

/** Resolve the active provider. Re-resolves when env changes (useful in tests). */
export function getEmailProvider(): EmailProvider {
  const choice = (process.env.EMAIL_PROVIDER ?? defaultChoice()).toLowerCase();
  if (cached && cachedKey === choice) return cached;
  cachedKey = choice;
  switch (choice) {
    case "resend":
      cached = resendEmail;
      break;
    case "smtp":
      cached = smtpEmail;
      break;
    case "mock":
      cached = mockEmail;
      break;
    case "console":
    default:
      cached = consoleEmail;
  }
  return cached;
}

function defaultChoice(): string {
  if (process.env.NODE_ENV === "test") return "mock";
  return "console";
}

/** Send `msg` via the active provider, logging on success/failure but never throwing
 *  past this call site — a delivery failure should not break the originating user
 *  action (the inviter, the registering user, etc.). */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult | null> {
  const provider = getEmailProvider();
  try {
    const result = await provider.send(msg);
    if (provider.name !== "console") {
      console.log(`[email] ok provider=${provider.name} id=${result.id} to=${msg.to}`);
    }
    return result;
  } catch (err) {
    console.error(
      `[email] FAIL provider=${provider.name} to=${msg.to} subject=${msg.subject}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export { inviteTemplate } from "./templates/invite";
export { verifyTemplate } from "./templates/verify";
export { resetTemplate } from "./templates/reset";
export { getOutbox, clearOutbox } from "./mock";
export type { EmailMessage, EmailProvider, EmailSendResult } from "./types";
