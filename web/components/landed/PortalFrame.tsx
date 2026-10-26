"use client";
import type { ReactNode } from "react";

export function PortalFrame({ vendorName, subtitle, children, actions }: { vendorName?: string | null; subtitle?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 rounded-md border bg-card px-4 py-3">
        <div>
          <div className="text-base font-semibold text-slate-900">{vendorName ?? "Vendor"} payment portal <span className="ml-1 rounded border px-1.5 align-middle text-[11px] font-normal text-muted-foreground">Demo</span></div>
          {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}
