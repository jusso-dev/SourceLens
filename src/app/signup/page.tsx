"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button, Card, Input, Label, Spinner } from "@/components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await authClient.signUp.email({ email, password, name });
    setLoading(false);
    if (res?.error) {
      setError(res.error.message ?? "Sign-up failed");
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold">Create your workspace</h1>
        <p className="mt-1 text-sm text-zinc-500">A personal workspace is created automatically.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
            <p className="mt-1 text-xs text-zinc-500">Minimum 8 characters.</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Spinner />} Create account
          </Button>
        </form>
        <p className="mt-5 text-sm text-zinc-500">
          Already have an account? <Link href="/login" className="text-indigo-600 hover:underline">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}
