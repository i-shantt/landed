import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  VERIFIED: "bg-green-100 text-green-800 border-green-200",
  PAID: "bg-green-100 text-green-800 border-green-200",
  LANDED: "bg-green-100 text-green-800 border-green-200",
  NEEDS_HUMAN: "bg-amber-100 text-amber-900 border-amber-200",
  UNCONFIRMED: "bg-red-100 text-red-800 border-red-200",
  RECOVERY: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

export function StateBadge({ state, className }: { state: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-xs", COLORS[state] ?? "bg-zinc-50 text-zinc-800 border-zinc-200", className)}>
      {state}
    </Badge>
  );
}

const ACCOUNT_COLORS: Record<string, string> = {
  verified: "bg-green-100 text-green-800 border-green-200",
  unverified: "bg-amber-100 text-amber-900 border-amber-200",
  probing: "bg-amber-100 text-amber-900 border-amber-200",
  disputed: "bg-red-100 text-red-800 border-red-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  superseded: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function AccountStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-xs", ACCOUNT_COLORS[status] ?? "")}>
      {status}
    </Badge>
  );
}
