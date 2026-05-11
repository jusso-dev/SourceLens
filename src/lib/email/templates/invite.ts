import type { EmailMessage } from "../types";

export interface InviteTemplateInput {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}

export function inviteTemplate(input: InviteTemplateInput): EmailMessage {
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on SourceLens`;
  const text = [
    `Hi,`,
    ``,
    `${input.inviterName} has invited you to join the "${input.workspaceName}" workspace on SourceLens as a ${input.role}.`,
    ``,
    `Accept this invitation:`,
    input.acceptUrl,
    ``,
    `This link expires on ${input.expiresAt.toUTCString()}.`,
    ``,
    `If you did not expect this email you can safely ignore it.`,
    ``,
    `— SourceLens`,
  ].join("\n");
  const html = [
    `<p>${escape(input.inviterName)} has invited you to join the <strong>${escape(input.workspaceName)}</strong> workspace on SourceLens as a <strong>${escape(input.role)}</strong>.</p>`,
    `<p><a href="${escape(input.acceptUrl)}">Accept the invitation</a></p>`,
    `<p style="color:#6b7280;font-size:12px">This link expires on ${escape(input.expiresAt.toUTCString())}.</p>`,
  ].join("");
  return {
    to: input.to,
    subject,
    text,
    html,
    tags: { kind: "invite", workspace: input.workspaceName.slice(0, 64) },
  };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
