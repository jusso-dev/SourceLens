import type { EmailMessage } from "../types";

export interface VerifyTemplateInput {
  to: string;
  name: string | null;
  verifyUrl: string;
  expiresAt: Date;
}

export function verifyTemplate(input: VerifyTemplateInput): EmailMessage {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const subject = "Confirm your SourceLens email";
  const text = [
    greeting,
    "",
    "Confirm your email to finish setting up your SourceLens account:",
    input.verifyUrl,
    "",
    `This link expires on ${input.expiresAt.toUTCString()}.`,
    "",
    "If you didn't sign up you can safely ignore this email.",
    "",
    "— SourceLens",
  ].join("\n");
  const html = [
    `<p>${greeting}</p>`,
    `<p>Confirm your email to finish setting up your SourceLens account.</p>`,
    `<p><a href="${escape(input.verifyUrl)}">Verify email</a></p>`,
    `<p style="color:#6b7280;font-size:12px">Expires ${escape(input.expiresAt.toUTCString())}.</p>`,
  ].join("");
  return { to: input.to, subject, text, html, tags: { kind: "verify" } };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
