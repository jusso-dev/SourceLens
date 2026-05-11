export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  tags?: Record<string, string>;
}

export interface EmailSendResult {
  /** Provider-side message id. May be a synthetic uuid for console/mock. */
  id: string;
  provider: string;
}

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}
