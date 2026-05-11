"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export default function ResetPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <Card className="w-full max-w-sm">
          <h1 className="text-xl font-semibold">Reset link invalid</h1>
          <p className="mt-2 text-sm text-zinc-500">
            This URL is missing a reset token. Request a new link from{" "}
            <Link href="/forgot" className="text-indigo-600 hover:underline">
              the forgot page
            </Link>
            .
          </p>
        </Card>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await authClient.resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (res?.error) {
      setError(res.error.message ?? "Reset failed — link may have expired");
      return;
    }
    router.replace("/login?reset=1");
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Choose a new password</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
            />
            <p className="mt-1 text-xs text-zinc-500">Minimum 8 characters.</p>
          </div>
          <div>
            <Label htmlFor="confirm">Confirm</Label>
            <Input
              id="confirm"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Spinner />} Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}
