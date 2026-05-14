import { promises as fs } from "node:fs";
import path from "node:path";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import type {
  AppControllerRoute,
  AppViewRoute,
  BullBoardQueues,
  ControllerHandlerReturnType,
  IServerAdapter,
  UIConfig,
} from "@bull-board/api/typings/app";
import { ForbiddenError, requireCurrentWorkspace } from "@/lib/auth/server";
import { env } from "@/lib/env";
import { getIngestQueue } from "@/lib/queue";

type ErrorHandler = (err: Error) => ControllerHandlerReturnType;

class NextBullBoardAdapter implements IServerAdapter {
  private basePath = "";
  private viewsPath = "";
  private staticRoute = "";
  private staticPath = "";
  private uiConfig: UIConfig = {};
  private queues: BullBoardQueues = new Map();
  private entryRoute: AppViewRoute | null = null;
  private apiRoutes: AppControllerRoute[] = [];
  private errorHandler: ErrorHandler | null = null;

  setBasePath(basePath: string) {
    this.basePath = basePath;
    return this;
  }

  setQueues(queues: BullBoardQueues) {
    this.queues = queues;
    return this;
  }

  setViewsPath(viewsPath: string) {
    this.viewsPath = viewsPath;
    return this;
  }

  setStaticPath(staticRoute: string, staticPath: string) {
    this.staticRoute = staticRoute;
    this.staticPath = staticPath;
    return this;
  }

  setUIConfig(config: UIConfig = {}) {
    this.uiConfig = config;
    return this;
  }

  setEntryRoute(routeDef: AppViewRoute) {
    this.entryRoute = routeDef;
    return this;
  }

  setErrorHandler(handler: ErrorHandler) {
    this.errorHandler = handler;
    return this;
  }

  setApiRoutes(routes: AppControllerRoute[]) {
    this.apiRoutes = routes;
    return this;
  }

  async handle(req: Request, rawPath: string): Promise<Response> {
    const pathname = normalisePath(rawPath);
    try {
      if (req.method === "GET" && pathname.startsWith(`${this.staticRoute}/`)) {
        return this.staticResponse(pathname);
      }

      const api = await this.apiResponse(req, pathname);
      if (api) return api;

      if (this.entryRoute && req.method.toLowerCase() === this.entryRoute.method) {
        const matched = matchAny(this.entryRoute.route, pathname);
        if (matched) return this.entryResponse();
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      if (!this.errorHandler) throw err;
      const response = this.errorHandler(err instanceof Error ? err : new Error(String(err)));
      return Response.json(response.body, { status: response.status });
    }
  }

  private async apiResponse(req: Request, pathname: string): Promise<Response | null> {
    for (const route of this.apiRoutes) {
      const methods = (Array.isArray(route.method) ? route.method : [route.method]) as string[];
      if (!methods.includes(req.method.toLowerCase())) continue;
      const matched = matchAny(route.route, pathname);
      if (!matched) continue;
      const response = await route.handler({
        queues: this.queues,
        uiConfig: this.uiConfig,
        query: queryObject(new URL(req.url).searchParams),
        params: matched,
        body: await requestBody(req),
        headers: Object.fromEntries(req.headers.entries()),
      });
      return Response.json(response.body, { status: response.status || 200 });
    }
    return null;
  }

  private async entryResponse(): Promise<Response> {
    if (!this.entryRoute) return new Response("Not found", { status: 404 });
    const { name, params } = this.entryRoute.handler({
      basePath: this.basePath,
      uiConfig: this.uiConfig,
    });
    const template = await fs.readFile(path.join(this.viewsPath, name), "utf8");
    return new Response(renderIndex(template, params), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private async staticResponse(pathname: string): Promise<Response> {
    const relative = pathname.slice(this.staticRoute.length + 1);
    const full = path.resolve(this.staticPath, relative);
    const base = path.resolve(this.staticPath);
    if (!full.startsWith(`${base}${path.sep}`)) return new Response("Not found", { status: 404 });
    const body = await fs.readFile(full);
    return new Response(body, {
      headers: { "content-type": contentType(full), "cache-control": "public, max-age=3600" },
    });
  }
}

let adapter: NextBullBoardAdapter | null = null;

function bullBoardAdapter() {
  if (!adapter) {
    adapter = new NextBullBoardAdapter().setBasePath("/internal/bull");
    createBullBoard({
      queues: [new BullMQAdapter(getIngestQueue())],
      serverAdapter: adapter,
      options: { uiConfig: { boardTitle: "SourceLens Bull Board" } },
    });
  }
  return adapter;
}

export async function requireBullBoardAccess() {
  const ctx = await requireCurrentWorkspace();
  const email = ctx.user.email.toLowerCase();
  if (ctx.role !== "owner" && !env.internalAdminEmails.includes(email)) {
    throw new ForbiddenError("Bull Board access is restricted to workspace owners");
  }
  return ctx;
}

export async function handleBullBoardRequest(req: Request, pathParts: string[] = []) {
  await requireBullBoardAccess();
  return bullBoardAdapter().handle(req, `/${pathParts.join("/")}`);
}

function normalisePath(rawPath: string) {
  const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return withSlash.replace(/\/+$/, "") || "/";
}

function matchAny(patterns: string | string[], pathname: string) {
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    const matched = matchRoute(pattern, pathname);
    if (matched) return matched;
  }
  return null;
}

function matchRoute(pattern: string, pathname: string) {
  const routeParts = normalisePath(pattern).split("/").filter(Boolean);
  const pathParts = normalisePath(pathname).split("/").filter(Boolean);
  if (routeParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeParts.length; i += 1) {
    const routePart = routeParts[i];
    const pathPart = pathParts[i];
    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = decodeURIComponent(pathPart);
    } else if (routePart !== pathPart) {
      return null;
    }
  }
  return params;
}

function queryObject(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const current = query[key];
    if (Array.isArray(current)) current.push(value);
    else if (current) query[key] = [current, value];
    else query[key] = value;
  }
  return query;
}

async function requestBody(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const text = await req.text();
  if (!text) return undefined;
  return JSON.parse(text);
}

function renderIndex(template: string, params: Record<string, string>) {
  return template
    .replace(/<%= basePath %>/g, escapeHtml(params.basePath))
    .replace(/<%= title %>/g, escapeHtml(params.title ?? "Bull Board"))
    .replace(/<%= favIconAlternative %>/g, escapeHtml(params.favIconAlternative ?? ""))
    .replace(/<%= favIconDefault %>/g, escapeHtml(params.favIconDefault ?? ""))
    .replace(/<%- uiConfig %>/g, params.uiConfig ?? "{}");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contentType(filePath: string) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".ico")) return "image/x-icon";
  return "application/octet-stream";
}
