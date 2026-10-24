"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { absTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

export function ClockDisplay() {
  const clock = useQuery(api.clock.get, {});
  if (!clock) return <span className="text-xs text-muted-foreground">clock…</span>;
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline" className="text-xs">
        {clock.mode === "demo" ? "demo clock" : "live clock"}
      </Badge>
      <span className="font-mono">{absTime(clock.now)}</span>
    </span>
  );
}

/** Hook: the application clock's current time (demo or live), with a fallback. */
export function useNow(): number {
  const clock = useQuery(api.clock.get, {});
  return clock?.now ?? Date.now();
}
