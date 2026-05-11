"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui";
import { authClient } from "@/lib/auth/client";

const NAV = [
  { href: "/app", label: "Dashboard", icon: "□" },
  { href: "/app/documents", label: "Documents", icon: "▢" },
  { href: "/app/search", label: "Search", icon: "⌕" },
  { href: "/app/ask", label: "Ask", icon: "?" },
  { href: "/app/jobs", label: "Jobs", icon: "↻" },
];

export function Sidebar({ user }: { user: { name?: string | null; email: string } }) {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="px-6 py-5 border-b border-zinc-200 dark:border-zinc-800">
        <Link href="/app" className="flex items-center gap-2 font-semibold text-base">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white">SL</span>
          SourceLens
        </Link>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                active
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                  : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <span className="font-mono text-zinc-400">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">Signed in as</div>
        <div className="text-sm font-medium truncate">{user.name ?? user.email}</div>
        <button
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/";
          }}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
