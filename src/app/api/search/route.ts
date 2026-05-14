import { z } from "zod";
import { prisma } from "@/lib/db";
import { authRateLimitKey, requireCurrentWorkspace, requireScope } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { enforceRateLimit } from "@/lib/ratelimit";
import { search } from "@/lib/search";

export const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z.enum(["keyword", "vector", "hybrid"]).default("hybrid"),
  documentIds: z.array(z.string()).optional(),
  fileTypes: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  rerank: z.boolean().optional(),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await requireCurrentWorkspace();
    requireScope(ctx, "search");
    const { workspace, user } = ctx;
    await enforceRateLimit("search", authRateLimitKey(ctx));
    const body = searchSchema.parse(await req.json());
    const result = await search(
      workspace.id,
      body.query,
      body.mode,
      { documentIds: body.documentIds, fileTypes: body.fileTypes },
      { limit: body.limit ?? 20, rerank: body.rerank ?? false },
    );
    await prisma.searchLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        query: body.query,
        mode: body.mode,
        resultCount: result.hits.length,
      },
    });
    return result;
  });
}
