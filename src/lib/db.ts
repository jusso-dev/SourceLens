import { PrismaClient } from "@prisma/client";
import { env } from "@/lib/env";

/** Hot-reload-safe Prisma singleton. Next.js dev re-evaluates modules on every
 *  change, which would otherwise create a fresh `PrismaClient` (and a fresh
 *  pool) per edit until the dev server runs out of Postgres connections. */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isProduction ? ["error"] : ["warn", "error"],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;
