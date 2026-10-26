"use client";
// Current operator. There is no auth provider in this build: the workspace picks a named operator
// (persisted per browser) and passes its id to controls mutations; the server enforces roles and
// segregation of duties. Production replaces this picker with SSO and keeps the same rules.
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

export type Operator = Doc<"operators">;
const KEY = "landed.operatorId";

type Ctx = {
  operators: Operator[] | undefined;
  operator: Operator | null;
  setOperatorId: (id: Id<"operators">) => void;
  /** True when the current operator may approve (approver or admin). */
  canApprove: boolean;
  isAdmin: boolean;
};

const OperatorContext = createContext<Ctx>({ operators: undefined, operator: null, setOperatorId: () => {}, canApprove: false, isAdmin: false });

// localStorage as an external store (no setState in effects; SSR snapshot is null).
const EVENT = "landed:operator";
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}
function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function OperatorProvider({ children }: { children: ReactNode }) {
  const operators = useQuery(api.controls.operators.list, {});
  const stored = useSyncExternalStore(subscribe, readStored, () => null);
  const setOperatorId = useCallback((id: Id<"operators">) => {
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* private mode: selection lives for this render tree only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  const operator = useMemo(() => {
    if (!operators || operators.length === 0) return null;
    return operators.find((o) => o._id === stored) ?? operators.find((o) => o.role === "clerk") ?? operators[0];
  }, [operators, stored]);
  const value = useMemo<Ctx>(
    () => ({ operators, operator, setOperatorId, canApprove: operator?.role === "approver" || operator?.role === "admin", isAdmin: operator?.role === "admin" }),
    [operators, operator, setOperatorId]
  );
  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator() {
  return useContext(OperatorContext);
}
