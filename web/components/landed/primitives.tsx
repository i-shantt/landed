"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-2">
      <div className="min-w-0 space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 flex flex-wrap items-center gap-2">{title}</h1>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "amber" | "red" | "green" }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl tabular-nums tracking-tight", tone === "amber" && "text-amber-800", tone === "red" && "text-red-800", tone === "green" && "text-emerald-800")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: { label: string; href: string } }) {
  return (
    <div className="rounded-md border border-dashed bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Button size="sm" className="mt-4" nativeButton={false} render={<Link href={action.href} />}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

export function KV({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={cn("text-sm", mono && "font-mono text-xs")}>{v}</dd>
    </>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="text-sm text-muted-foreground" role="status">{label}</p>;
}
