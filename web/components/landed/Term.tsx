"use client";
import { useId, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TERMS, type TermKey } from "@/lib/terms";

/**
 * A term with a hover/focus definition. Renders the children (or the term label) with a dotted
 * underline. The trigger is a real button so keyboard and screen-reader users reach it; the
 * definition is linked with aria-describedby (always present, visually hidden) so it is read
 * even before the tooltip opens.
 */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const t = TERMS[k];
  const descId = useId();
  if (!t) return <>{children ?? k}</>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-describedby={descId} />}
        className="cursor-help rounded-sm bg-transparent p-0 text-inherit [font:inherit] underline decoration-dotted decoration-slate-400 underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children ?? t.label}
      </TooltipTrigger>
      <span id={descId} className="sr-only">
        {t.label}: {t.definition}
      </span>
      <TooltipContent className="max-w-sm text-left leading-snug">
        <span className="font-medium">{t.label}.</span> {t.definition}
      </TooltipContent>
    </Tooltip>
  );
}
