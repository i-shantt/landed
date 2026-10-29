"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useOperator } from "@/lib/operator";
import { ROLE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Top-bar identity: the signed-in operator (name, role, email) and sign-out. Roles are enforced on the server. */
export function UserMenu({ compact }: { compact?: boolean }) {
  const { operator, loading, signedIn } = useOperator();
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!signedIn && !loading) {
    return (
      <Link href="/signin" className="rounded-full border border-[#dfe5e2] bg-[#edf1ee] px-3 py-1 text-xs font-medium text-[#2f4a3d] hover:bg-[#e3eae5]">
        Sign in
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cn("flex items-center gap-2 rounded-full border border-[#dfe5e2] bg-[#edf1ee] py-0.5 pl-0.5 pr-2 text-xs text-[#2f4a3d] hover:bg-[#e3eae5]", compact && "pr-0.5")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={operator ? `Signed in as ${operator.name}, ${ROLE_LABEL[operator.role]}. Account menu` : "Account menu"}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[10px] font-semibold text-[#557061]">{operator?.initials ?? <UserRound size={12} />}</span>
        {!compact && (
          <span className="hidden sm:flex sm:flex-col sm:items-start sm:leading-tight">
            <span className="font-medium">{operator?.name ?? (loading ? "Loading…" : "No operator")}</span>
            <span className="text-[10px] text-[#6b7a72]">{operator ? ROLE_LABEL[operator.role] : loading ? "" : "not linked"}</span>
          </span>
        )}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-md border bg-white py-1 text-sm shadow-lg">
          <div className="px-3 py-2">
            <div className="font-medium">{operator?.name ?? "Signed in"}</div>
            <div className="text-[11px] text-muted-foreground">
              {operator ? ROLE_LABEL[operator.role] : "No operator linked to this account"}
              {operator?.userEmail ? ` · ${operator.userEmail}` : ""}
            </div>
          </div>
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Roles are enforced on the server on every call. Every action is recorded under this name.</div>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 border-t px-3 py-2 text-left hover:bg-slate-50"
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.push("/signin");
            }}
          >
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
