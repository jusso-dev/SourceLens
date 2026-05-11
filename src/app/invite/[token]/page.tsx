"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Badge, Button, Card, Spinner } from "@/components/ui";

interface InviteInfo {
  workspace: { id: string; name: string; slug: string };
  role: string;
  email: string;
  invitedBy: { name: string | null; email: string };
  expiresAt: string;
}

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const { data: session } = authClient.useSession();

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/invitations/${token}`);
      const data = await r.json();
      if (!r.ok) setError(data.error ?? "Invitation invalid");
      else setInfo(data);
      setLoading(false);
    })();
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    const r = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
    setAccepting(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "Accept failed");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold">Workspace invitation</h1>

        {loading && <div className="mt-4 text-sm text-zinc-500"><Spinner /> Loading…</div>}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {info && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium">{info.invitedBy.name ?? info.invitedBy.email}</span> invited
              <span className="font-mono"> {info.email} </span>
              to join <span className="font-medium">{info.workspace.name}</span> as a <Badge>{info.role}</Badge>.
            </p>
            <p className="text-xs text-zinc-500">Expires {new Date(info.expiresAt).toLocaleString()}.</p>

            {!session?.user && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm">
                Sign in as <code className="font-mono">{info.email}</code> to accept this invite.
                <div className="mt-2 flex gap-2">
                  <Link href={`/login?next=/invite/${token}`}><Button size="sm">Sign in</Button></Link>
                  <Link href={`/signup?next=/invite/${token}`}><Button size="sm" variant="secondary">Sign up</Button></Link>
                </div>
              </div>
            )}

            {session?.user && (
              <Button onClick={accept} disabled={accepting} className="w-full">
                {accepting && <Spinner />} Accept invitation
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
