import * as React from "react";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...rest }, ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm" }[size];
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    secondary: "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800",
    ghost: "hover:bg-zinc-100 dark:hover:bg-zinc-800",
    danger: "bg-red-600 text-white hover:bg-red-500",
  }[variant];
  return <button ref={ref} className={cn(base, sizes, variants, className)} {...rest} />;
});

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          className,
        )}
        {...rest}
      />
    );
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full min-h-[96px] rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        className,
      )}
      {...rest}
    />
  );
});

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sl-card p-6", className)} {...rest} />;
}

export function Label({ className, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-zinc-700 dark:text-zinc-300", className)} {...rest} />;
}

type BadgeTone = "neutral" | "blue" | "amber" | "green" | "red" | "violet";

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin h-4 w-4", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="sl-card flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-2 text-base font-semibold">{title}</div>
      {description && <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "indexed" || status === "completed"
      ? "green"
      : status === "failed"
        ? "red"
        : status === "processing" || status === "active"
          ? "blue"
          : status === "uploaded" || status === "waiting" || status === "delayed"
            ? "amber"
            : "neutral";
  return <Badge tone={tone}>{status}</Badge>;
}
