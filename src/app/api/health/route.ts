import { prisma } from "@/lib/db";
import { getRawRedis } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [db, redis] = await Promise.allSettled([
    prisma.user.count({ take: 1 }),
    getRawRedis().ping(),
  ]);
  const body = {
    ok: db.status === "fulfilled" && redis.status === "fulfilled",
    db: db.status === "fulfilled",
    redis: redis.status === "fulfilled",
  };
  return Response.json(body, { status: body.ok ? 200 : 503 });
}
