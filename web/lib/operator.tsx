"use client";
// Current operator = the operator row linked to the signed-in user (Convex Auth, api.controls.operators.me).
// The server enforces roles and segregation of duties on every call; this context only shapes the UI.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

export type Operator = Doc<"operators"> & { userEmail: string | null };

type Ctx = {
  /** The signed-in operator, or null when signed out or not linked to an operator. */
  operator: Operator | null;
  /** True while the session or the operator row is still loading. */
  loading: boolean;
  signedIn: boolean;
  /** True when the current operator may approve (approver or admin). */
  canApprove: boolean;
  isAdmin: boolean;
};

const OperatorContext = createContext<Ctx>({ operator: null, loading: true, signedIn: false, canApprove: false, isAdmin: false });

export function OperatorProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.controls.operators.me, isAuthenticated ? {} : "skip");
  const value = useMemo<Ctx>(() => {
    const operator = isAuthenticated && me ? me : null;
    return {
      operator,
      loading: isLoading || (isAuthenticated && me === undefined),
      signedIn: isAuthenticated,
      canApprove: operator?.role === "approver" || operator?.role === "admin",
      isAdmin: operator?.role === "admin",
    };
  }, [isAuthenticated, isLoading, me]);
  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator() {
  return useContext(OperatorContext);
}
