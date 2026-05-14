import { handleBullBoardRequest } from "@/lib/bull-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BullRouteContext = { params: Promise<{ path?: string[] }> };

async function handle(req: Request, ctx: BullRouteContext) {
  const { path = [] } = await ctx.params;
  return handleBullBoardRequest(req, path);
}

export async function GET(req: Request, ctx: BullRouteContext) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: BullRouteContext) {
  return handle(req, ctx);
}

export async function PUT(req: Request, ctx: BullRouteContext) {
  return handle(req, ctx);
}

export async function PATCH(req: Request, ctx: BullRouteContext) {
  return handle(req, ctx);
}

export async function DELETE(req: Request, ctx: BullRouteContext) {
  return handle(req, ctx);
}
