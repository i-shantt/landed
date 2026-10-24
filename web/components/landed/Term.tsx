"use client";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TERMS, type TermKey } from "@/lib/terms";

/** A term with a hover/focus definition. Renders the children (or the term label) with a dotted underline. */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const t = TERMS[k];
  if (!t) return <>{children ?? k}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} role="term" aria-label={`${t.label}: ${t.definition}`} />}
        className="cursor-help rounded-sm underline decoration-dotted decoration-slate-400 underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children ?? t.label}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-left leading-snug">
        <span className="font-medium">{t.label}.</span> {t.definition}
      </TooltipContent>
    </Tooltip>
  );
}
