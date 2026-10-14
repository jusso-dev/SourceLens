import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import type { AuditAction } from "@prisma/client";
import { RateLimitError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  type AnonBucketName,
  enforceAnonRateLimit,
  getClientIp,
  rateLimitHeaders,
} from "@/lib/ratelimit";

const inner = toNextJsHandler(auth);

/** Map better-auth path suffix → anonymous bucket. Order matters: longer
 *  suffixes first so `request-password-reset` does not match `password-reset`
 *  if better-auth ever renames the endpoint. */
const PATH_BUCKETS: Array<[string, AnonBucketName]> = [
  ["/sign-up/email", "signUp"],
  ["/sign-up", "signUp"],
  ["/sign-in/email", "signIn"],
  ["/sign-in", "signIn"],
  ["/forget-password", "passwordReset"],
  ["/reset-password", "passwordReset"],
  ["/request-password-reset", "passwordReset"],
  ["/send-verification-email", "verifyResend"],
  ["/verify-email", "verifyResend"],
];

const PATH_ACTIONS: Array<[string, AuditAction]> = [
  ["/sign-up/email", "auth_signup"],
  ["/sign-in/email", "auth_login"],
  ["/forget-password", "auth_password_reset_request"],
  ["/reset-password", "auth_password_change"],
  ["/change-password", "auth_password_change"],
  ["/verify-email", "auth_email_verified"],
  ["/sign-out", "auth_session_revoke"],
];

async function gate(req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  for (const [suffix, bucket] of PATH_BUCKETS) {
    if (path.endsWith(suffix)) {
      const ip = getClientIp(req);
      try {
        await enforceAnonRateLimit(bucket, ip);
      } catch (err) {
        if (err instanceof RateLimitError) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 429,
            headers: { "content-type": "application/json", ...rateLimitHeaders(err.rate) },
          });
        }
        throw err;
      }
      return null;
    }
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  const res = await inner.GET(req);
  await auditAuthEvent(req, res);
  return res;
}

export async function POST(req: Request) {
  const auditReq = req.clone();
  const blocked = await gate(req);
  if (blocked) return blocked;
  const res = await inner.POST(req);
  await auditAuthEvent(auditReq, res);
  return res;
}

async function auditAuthEvent(req: Request, res: Response): Promise<void> {
  if (res.status < 200 || res.status >= 300) return;
  const path = new URL(req.url).pathname;
  const action = PATH_ACTIONS.find(([suffix]) => path.endsWith(suffix))?.[1];
  if (!action) return;

  const body = await readJsonBody(req);
  const email = typeof body?.email === "string" ? body.email : null;
  const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  const userId = session?.user?.id ?? (email ? await findUserIdByEmail(email) : null);
  const workspaceId = userId ? await findWorkspaceIdForUser(userId) : null;

  await audit(action, {
    workspaceId,
    actorId: userId,
    targetType: "auth",
    targetId: userId,
    metadata: email ? { email: redactEmail(email) } : {},
    request: req,
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  if (!["POST", "PUT", "PATCH"].includes(req.method)) return null;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  return user?.id ?? null;
}

async function findWorkspaceIdForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentWorkspaceId: true },
  });
  if (user?.currentWorkspaceId) return user.currentWorkspaceId;
  const membership = await prisma.membership.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  return membership?.workspaceId ?? null;
}

function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "[redacted]";
  return `${local.slice(0, 2)}***@${domain}`;
}
