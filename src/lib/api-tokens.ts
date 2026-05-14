import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiToken } from "@prisma/client";

export const API_TOKEN_PREFIX = "sl";

export const API_TOKEN_SCOPES = [
  "documents:read",
  "documents:write",
  "search",
  "ask",
  "admin",
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const DEFAULT_API_TOKEN_SCOPES: ApiTokenScope[] = [
  "documents:read",
  "search",
  "ask",
];

export interface IssuedApiToken {
  prefix: string;
  secret: string;
  token: string;
  hashedSecret: string;
}

export function issueApiToken(): IssuedApiToken {
  const prefix = randomBytes(4).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  return {
    prefix,
    secret,
    token: `${API_TOKEN_PREFIX}_${prefix}_${secret}`,
    hashedSecret: hashApiTokenSecret(secret),
  };
}

export function parseApiToken(value: string): { prefix: string; secret: string } | null {
  const parts = value.split("_");
  if (parts.length !== 3) return null;
  const [marker, prefix, secret] = parts;
  if (marker !== API_TOKEN_PREFIX || !prefix || !secret) return null;
  return { prefix, secret };
}

export function hashApiTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function verifyApiTokenSecret(secret: string, hashedSecret: string): boolean {
  const candidate = Buffer.from(hashApiTokenSecret(secret), "hex");
  const expected = Buffer.from(hashedSecret, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function normaliseScopes(raw: unknown): ApiTokenScope[] {
  if (!Array.isArray(raw)) return DEFAULT_API_TOKEN_SCOPES;
  const allowed = new Set<string>(API_TOKEN_SCOPES);
  const scopes = raw.filter((scope): scope is ApiTokenScope => {
    return typeof scope === "string" && allowed.has(scope);
  });
  return Array.from(new Set(scopes));
}

export function tokenScopes(token: Pick<ApiToken, "scopes">): ApiTokenScope[] {
  return normaliseScopes(token.scopes);
}
