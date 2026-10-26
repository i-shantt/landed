"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, UserRound } from "lucide-react";
import { useOperator } from "@/lib/operator";
import { cn } from "@/lib/utils";

export const ROLE_LABEL: Record<string, string> = { clerk: "AP clerk", approver: "Approver", admin: "Administrator" };

/** Top-bar operator picker. Who is acting is recorded on every controls action. */
export function OperatorMenu({ compact }: { compact?: boolean }) {
  const { operators, operator, setOperatorId } = useOperator();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cn("flex items-center gap-2 rounded-full border border-[#dfe5e2] bg-[#edf1ee] py-0.5 pl-0.5 pr-2 text-xs text-[#2f4a3d] hover:bg-[#e3eae5]", compact && "pr-0.5")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={operator ? `Acting as ${operator.name}, ${ROLE_LABEL[operator.role]}. Change operator` : "Choose operator"}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[10px] font-semibold text-[#557061]">{operator?.initials ?? <UserRound size={12} />}</span>
        {!compact && (
          <span className="hidden sm:flex sm:flex-col sm:items-start sm:leading-tight">
            <span className="font-medium">{operator?.name ?? "Choose operator"}</span>
            <span className="text-[10px] text-[#6b7a72]">{operator ? ROLE_LABEL[operator.role] : "no identity"}</span>
          </span>
        )}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-label="Operators" className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-md border bg-white py-1 text-sm shadow-lg">
          <li className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Act as</li>
          {(operators ?? []).map((o) => (
            <li key={o._id}>
              <button
                type="button"
                role="option"
                aria-selected={o._id === operator?._id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
                onClick={() => {
                  setOperatorId(o._id);
                  setOpen(false);
                }}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#edf1ee] text-[10px] font-semibold text-[#557061]">{o.initials}</span>
                <span className="flex-1">
                  <span className="block">{o.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{ROLE_LABEL[o.role]}</span>
                </span>
                {o._id === operator?._id && <Check size={14} className="text-emerald-700" aria-hidden />}
              </button>
            </li>
          ))}
          <li className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">No sign-in in this build: the picker stands in for SSO. Roles are enforced on the server.</li>
        </ul>
      )}
    </div>
  );
}
