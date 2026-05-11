import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireCurrentWorkspace } from "@/lib/auth/server";
import { withApi } from "@/lib/api";
import { search } from "@/lib/search";

export const searchSchema = z.object({
  query: z.string().min(1).max(2000),
  mode: z.enum(["keyword", "vector", "hybrid"]).default("hybrid"),
  documentIds: z.array(z.string()).optional(),
  fileTypes: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  return withApi(async () => {
    const { workspace, user } = await requireCurrentWorkspace();
    const body = searchSchema.parse(await req.json());
    const result = await search(
      workspace.id,
      body.query,
      body.mode,
      { documentIds: body.documentIds, fileTypes: body.fileTypes },
      body.limit ?? 20,
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
