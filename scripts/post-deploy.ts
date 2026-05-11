/** Apply post-deploy SQL (vector + FTS indexes). Idempotent. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.resolve(process.cwd(), "prisma/post-deploy.sql");
  const sql = readFileSync(sqlPath, "utf8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"));
  for (const stmt of statements) {
    console.log("→", stmt.split("\n")[0].slice(0, 80));
    await prisma.$executeRawUnsafe(stmt);
  }
  console.log("Post-deploy complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
