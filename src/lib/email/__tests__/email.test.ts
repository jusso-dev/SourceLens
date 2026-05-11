import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOutbox,
  getEmailProvider,
  getOutbox,
  inviteTemplate,
  resetTemplate,
  sendEmail,
  verifyTemplate,
} from "../index";

const ORIG_PROVIDER = process.env.EMAIL_PROVIDER;

beforeEach(() => {
  process.env.EMAIL_PROVIDER = "mock";
  clearOutbox();
});

afterEach(() => {
  if (ORIG_PROVIDER === undefined) delete process.env.EMAIL_PROVIDER;
  else process.env.EMAIL_PROVIDER = ORIG_PROVIDER;
});

describe("getEmailProvider", () => {
  it("returns mock when EMAIL_PROVIDER=mock", () => {
    process.env.EMAIL_PROVIDER = "mock";
    expect(getEmailProvider().name).toBe("mock");
  });

  it("falls back to console for unknown values", () => {
    process.env.EMAIL_PROVIDER = "totally-unknown";
    expect(getEmailProvider().name).toBe("console");
  });

  it("re-resolves on env change", () => {
    process.env.EMAIL_PROVIDER = "mock";
    expect(getEmailProvider().name).toBe("mock");
    process.env.EMAIL_PROVIDER = "console";
    expect(getEmailProvider().name).toBe("console");
  });
});

describe("inviteTemplate", () => {
  const base = {
    to: "alice@example.com",
    workspaceName: "Acme",
    inviterName: "Bob",
    role: "member",
    acceptUrl: "https://app.example.com/invite/abc",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  };

  it("renders the workspace, role, and accept URL into both text and html", () => {
    const msg = inviteTemplate(base);
    expect(msg.subject).toContain("Acme");
    expect(msg.subject).toContain("Bob");
    expect(msg.text).toContain("Acme");
    expect(msg.text).toContain("https://app.example.com/invite/abc");
    expect(msg.html).toContain("Acme");
    expect(msg.html).toContain("https://app.example.com/invite/abc");
  });

  it("escapes HTML-unsafe characters in workspace name", () => {
    const msg = inviteTemplate({ ...base, workspaceName: "<script>x</script>" });
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });
});

describe("verifyTemplate", () => {
  it("uses name when provided, generic greeting otherwise", () => {
    const named = verifyTemplate({
      to: "u@example.com",
      name: "Justin",
      verifyUrl: "https://x",
      expiresAt: new Date(),
    });
    expect(named.text).toContain("Hi Justin,");

    const anon = verifyTemplate({
      to: "u@example.com",
      name: null,
      verifyUrl: "https://x",
      expiresAt: new Date(),
    });
    expect(anon.text).toContain("Hi,");
  });
});

describe("resetTemplate", () => {
  it("includes the reset URL in both text and html", () => {
    const msg = resetTemplate({
      to: "u@example.com",
      name: null,
      resetUrl: "https://reset.url/abc",
      expiresAt: new Date(),
    });
    expect(msg.text).toContain("https://reset.url/abc");
    expect(msg.html).toContain("https://reset.url/abc");
    expect(msg.subject.toLowerCase()).toContain("reset");
  });
});

describe("sendEmail via mock provider", () => {
  it("delivers to the in-memory outbox and returns a result", async () => {
    const msg = inviteTemplate({
      to: "alice@example.com",
      workspaceName: "Acme",
      inviterName: "Bob",
      role: "admin",
      acceptUrl: "https://x",
      expiresAt: new Date(),
    });
    const result = await sendEmail(msg);
    expect(result?.provider).toBe("mock");
    expect(result?.id).toMatch(/[0-9a-f-]/);
    const outbox = getOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("alice@example.com");
    expect(outbox[0].subject).toContain("Acme");
  });

  it("never throws on provider failure — returns null", async () => {
    // Resend provider without env should reject; getEmailProvider re-resolves to resend.
    process.env.EMAIL_PROVIDER = "resend";
    delete process.env.RESEND_API_KEY;
    const result = await sendEmail({ to: "x@y.z", subject: "s", text: "t" });
    expect(result).toBeNull();
  });
});
