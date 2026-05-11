import type { EmailMessage } from "../types";

export interface ResetTemplateInput {
  to: string;
  name: string | null;
  resetUrl: string;
  expiresAt: Date;
}

export function resetTemplate(input: ResetTemplateInput): EmailMessage {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const subject = "Reset your SourceLens password";
  const text = [
    greeting,
    "",
    "We received a request to reset your SourceLens password.",
    "Reset it here:",
    input.resetUrl,
    "",
    `This link expires on ${input.expiresAt.toUTCString()}.`,
    "",
    "If you didn't request this you can ignore this email — your password will stay unchanged.",
    "",
    "— SourceLens",
  ].join("\n");
  const html = [
    `<p>${greeting}</p>`,
    `<p>We received a request to reset your SourceLens password.</p>`,
    `<p><a href="${escape(input.resetUrl)}">Reset password</a></p>`,
    `<p style="color:#6b7280;font-size:12px">Expires ${escape(input.expiresAt.toUTCString())}. If you didn't request this you can ignore this email.</p>`,
  ].join("");
  return { to: input.to, subject, text, html, tags: { kind: "reset" } };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
