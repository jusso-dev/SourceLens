import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { RateLimitError } from "@/lib/api";
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
  return blocked ?? inner.GET(req);
}

export async function POST(req: Request) {
  const blocked = await gate(req);
  return blocked ?? inner.POST(req);
}
