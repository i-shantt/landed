"use client";
import Link from "next/link";
import { useSettings } from "@/lib/hooks";
import { cn } from "@/lib/utils";

function Chip({ k, v, tone }: { k: string; v: string; tone?: "amber" }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-md border bg-card px-1.5 text-[11px]", tone === "amber" && "border-amber-200 bg-amber-50 text-amber-900")}>
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono">{v}</span>
    </span>
  );
}

export function ModeChips() {
  const s = useSettings();
  const extractor = s?.extractorMode ?? "rules";
  return (
    <Link href="/settings" className="flex items-center gap-1.5" aria-label="Open settings for extractor, rail and voice modes">
      <Chip k="extractor" v={extractor} tone={extractor === "off" ? "amber" : undefined} />
      <Chip k="rail" v={s?.rail ?? "sim"} />
      <Chip k="voice" v={s?.voice ?? "sim"} />
    </Link>
  );
}
