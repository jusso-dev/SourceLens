"use client";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset" });
    setLoading(false);
    if (res?.error) {
      setError(res.error.message ?? "Could not send reset email");
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Reset your password</h1>
        {sent ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            If an account exists for <span className="font-mono">{email}</span>, a reset
            link is on its way. The link expires in one hour.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-zinc-500">
              Enter the email tied to your SourceLens account and we&apos;ll send a reset
              link.
            </p>
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading && <Spinner />} Send reset link
              </Button>
            </form>
          </>
        )}
        <p className="mt-5 text-sm text-zinc-500">
          Remembered it?{" "}
          <Link href="/login" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </div>
  );
}
