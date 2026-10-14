import type { AuditAction, Prisma } from "@prisma/client";
import { Badge, EmptyState } from "@/components/ui";
import { requireCurrentWorkspaceRole } from "@/lib/auth/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ACTIONS: AuditAction[] = [
  "workspace_create",
  "workspace_rename",
  "workspace_delete",
  "workspace_transfer_ownership",
  "membership_invite",
  "membership_accept",
  "membership_role_change",
  "membership_remove",
  "document_upload",
  "document_delete",
  "document_retry",
  "document_reindex",
  "chunk_delete",
  "auth_signup",
  "auth_login",
  "auth_password_reset_request",
  "auth_password_change",
  "auth_email_verified",
  "auth_session_revoke",
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace } = await requireCurrentWorkspaceRole("admin");
  const params = (await searchParams) ?? {};
  const action = single(params.action);
  const targetType = single(params.targetType);
  const actor = single(params.actor);

  const where: Prisma.AuditLogWhereInput = { workspaceId: workspace.id };
  if (ACTIONS.includes(action as AuditAction)) where.action = action as AuditAction;
  if (targetType) where.targetType = { equals: targetType, mode: "insensitive" };
  if (actor) {
    where.actor = {
      OR: [
        { email: { contains: actor, mode: "insensitive" } },
        { name: { contains: actor, mode: "insensitive" } },
      ],
    };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { email: true, name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-zinc-500">Sensitive activity for {workspace.name}, newest first.</p>
      </div>

      <form className="sl-card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Actor</span>
          <input
            name="actor"
            defaultValue={actor}
            placeholder="Email or name"
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Action</span>
          <select
            name="action"
            defaultValue={ACTIONS.includes(action as AuditAction) ? action : ""}
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">All actions</option>
            {ACTIONS.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Target</span>
          <input
            name="targetType"
            defaultValue={targetType}
            placeholder="document"
            className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <div className="flex items-end gap-2">
          <button className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500">
            Filter
          </button>
          <a
            href="/app/admin/audit"
            className="inline-flex h-10 items-center rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700"
          >
            Clear
          </a>
        </div>
      </form>

      {logs.length === 0 ? (
        <EmptyState title="No audit entries" description="Matching activity will appear here." />
      ) : (
        <div className="sl-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3">Network</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-500">
                    {log.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(log.action)}>{label(log.action)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {log.actor ? (
                      <>
                        <div className="font-medium">{log.actor.name ?? log.actor.email}</div>
                        <div className="text-xs text-zinc-500">{log.actor.email}</div>
                      </>
                    ) : (
                      <span className="text-zinc-500">System</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{log.targetType}</div>
                    {log.targetId && <div className="text-xs text-zinc-500">{log.targetId}</div>}
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <code className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-300">
                      {JSON.stringify(log.metadata)}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    <div>{log.ip ?? "unknown IP"}</div>
                    <div className="max-w-[220px] truncate">{log.userAgent ?? "unknown agent"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function label(action: string): string {
  return action.replaceAll("_", " ");
}

function tone(action: AuditAction) {
  if (action.startsWith("document")) return "blue";
  if (action.startsWith("membership")) return "violet";
  if (action.startsWith("auth")) return "amber";
  if (action.includes("delete") || action.includes("remove")) return "red";
  return "neutral";
}
