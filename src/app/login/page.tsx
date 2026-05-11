"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/app";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (res?.error) {
      setError(res.error.message ?? "Sign-in failed");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to your SourceLens workspace.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Spinner />} Sign in
          </Button>
        </form>
        <p className="mt-5 text-sm text-zinc-500">
          No account? <Link href="/signup" className="text-indigo-600 hover:underline">Sign up</Link>
        </p>
      </Card>
    </div>
  );
}
