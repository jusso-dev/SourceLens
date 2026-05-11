"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Input, Label, Spinner } from "@/components/ui";

type Role = "owner" | "admin" | "member" | "viewer";

interface Member {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: string;
  createdAt: string;
}

interface CurrentWorkspace {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const [ws, setWs] = useState<CurrentWorkspace | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invitation[] | null>(null);
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/workspaces", { cache: "no-store" });
    if (!r.ok) return;
    const data = await r.json();
    const current = (data.workspaces as Array<CurrentWorkspace>).find(
      (w) => w.id === data.currentWorkspaceId,
    );
    if (!current) return;
    setWs(current);
    setName(current.name);

    const [m, inv] = await Promise.all([
      fetch(`/api/workspaces/${current.id}/members`).then((r) => r.json()),
      ["owner", "admin"].includes(current.role)
        ? fetch(`/api/workspaces/${current.id}/invitations`).then((r) => r.json())
        : Promise.resolve({ invitations: [] }),
    ]);
    setMembers(m.members);
    setInvites(inv.invitations ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  if (!ws) return <Card><Spinner /> Loading…</Card>;
  const isAdmin = ws.role === "owner" || ws.role === "admin";
  const isOwner = ws.role === "owner";

  async function rename(e: React.FormEvent) {
    if (!ws) return;
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/workspaces/${ws.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setBusy(false);
    if (!r.ok) {
      setError("Rename failed");
      return;
    }
    router.refresh();
    refresh();
  }

  async function deleteWorkspace() {
    if (!ws) return;
    if (!confirm(`Delete "${ws.name}"? Documents, chunks, members, and invitations will be removed.`)) return;
    setBusy(true);
    const r = await fetch(`/api/workspaces/${ws.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Delete failed");
      return;
    }
    window.location.href = "/app";
  }

  async function changeRole(userId: string, role: Role) {
    if (!ws) return;
    const r = await fetch(`/api/workspaces/${ws.id}/members/${userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Role change failed");
    } else {
      refresh();
    }
  }

  async function removeMember(userId: string) {
    if (!ws) return;
    if (!confirm("Remove this member from the workspace?")) return;
    const r = await fetch(`/api/workspaces/${ws.id}/members/${userId}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Remove failed");
    } else {
      refresh();
    }
  }

  async function invite(e: React.FormEvent) {
    if (!ws) return;
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    const r = await fetch(`/api/workspaces/${ws.id}/invitations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Invite failed");
      return;
    }
    const data = await r.json();
    setInviteEmail("");
    if (data.acceptUrl) setInviteUrl(data.acceptUrl);
    refresh();
  }

  async function revokeInvite(id: string) {
    if (!ws) return;
    await fetch(`/api/workspaces/${ws.id}/invitations/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Workspace settings</h1>
        <p className="text-sm text-zinc-500">Manage {ws.name} (/{ws.slug}).</p>
      </div>

      {error && <Card className="border-red-200 text-red-700">{error}</Card>}

      <Card>
        <h2 className="text-base font-semibold">General</h2>
        <form onSubmit={rename} className="mt-4 max-w-md space-y-3">
          <div>
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
              className="mt-1"
            />
          </div>
          <div className="text-xs text-zinc-500">Slug <code className="font-mono">{ws.slug}</code> is permanent.</div>
          {isAdmin && (
            <Button type="submit" disabled={busy || name === ws.name}>{busy && <Spinner />} Save</Button>
          )}
        </form>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">Members</h2>
        {members === null ? (
          <div className="mt-4 text-sm text-zinc-500"><Spinner /> Loading…</div>
        ) : members.length === 0 ? (
          <EmptyState title="No members" />
        ) : (
          <table className="w-full text-sm mt-4">
            <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <tr><th className="py-2">Member</th><th className="py-2">Role</th><th className="py-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                  <td className="py-3">
                    <div className="font-medium">{m.name ?? m.email}</div>
                    <div className="text-xs text-zinc-500">{m.email}</div>
                  </td>
                  <td className="py-3">
                    {isAdmin && m.role !== "owner" ? (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.userId, e.target.value as Role)}
                        className="h-8 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2"
                      >
                        {(["admin", "member", "viewer"] as const).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                        {isOwner && <option value="owner">owner</option>}
                      </select>
                    ) : (
                      <Badge tone={m.role === "owner" ? "violet" : "neutral"}>{m.role}</Badge>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {isAdmin && m.role !== "owner" && (
                      <Button size="sm" variant="ghost" onClick={() => removeMember(m.userId)}>Remove</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <h2 className="text-base font-semibold">Invitations</h2>
          <form onSubmit={invite} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="grow min-w-[200px]">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="mt-1 h-10 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm px-2"
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
            <Button type="submit" disabled={busy}>{busy && <Spinner />} Send invite</Button>
          </form>

          {inviteUrl && (
            <p className="mt-3 text-xs text-zinc-500 break-all">
              Share this link with the invitee (email delivery is stubbed): <code className="font-mono">{inviteUrl}</code>
            </p>
          )}

          {invites && invites.length > 0 && (
            <table className="w-full text-sm mt-5">
              <thead className="text-left text-xs uppercase text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <tr><th className="py-2">Email</th><th className="py-2">Role</th><th className="py-2">Expires</th><th className="py-2 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                    <td className="py-2">{i.email}</td>
                    <td className="py-2"><Badge>{i.role}</Badge></td>
                    <td className="py-2 text-zinc-500">{new Date(i.expiresAt).toLocaleString()}</td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => revokeInvite(i.id)}>Revoke</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {isOwner && (
        <Card className="border-red-200 dark:border-red-900">
          <h2 className="text-base font-semibold text-red-700">Danger zone</h2>
          <p className="mt-1 text-sm text-zinc-500">Delete this workspace and everything in it. Cannot be undone.</p>
          <Button variant="danger" className="mt-4" onClick={deleteWorkspace} disabled={busy}>
            Delete workspace
          </Button>
        </Card>
      )}
    </div>
  );
}
