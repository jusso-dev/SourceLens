"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button, Card, Spinner } from "@/components/ui";

export default function VerifyPendingPage() {
  return (
    <Suspense fallback={null}>
      <VerifyPending />
    </Suspense>
  );
}

function VerifyPending() {
  const params = useSearchParams();
  const email = params.get("email");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setSending(true);
    setError(null);
    const res = await authClient.sendVerificationEmail({ email, callbackURL: "/app" });
    setSending(false);
    if (res?.error) {
      setError(res.error.message ?? "Could not resend verification email");
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Confirm your email</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {email ? (
            <>
              We sent a confirmation link to <span className="font-mono">{email}</span>.
              Click it to finish setting up your account.
            </>
          ) : (
            <>We sent a confirmation link to your inbox. Click it to finish setting up your account.</>
          )}
        </p>

        {email && (
          <div className="mt-5">
            <Button onClick={resend} disabled={sending || sent} className="w-full" variant="secondary">
              {sending && <Spinner />} {sent ? "Sent — check your inbox" : "Resend verification email"}
            </Button>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <p className="mt-5 text-sm text-zinc-500">
          Wrong email?{" "}
          <Link href="/signup" className="text-indigo-600 hover:underline">
            Start over
          </Link>
        </p>
      </Card>
    </div>
  );
}
