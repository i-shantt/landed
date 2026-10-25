import { ArrowDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("landed-brand", className)}>
      <span className="landed-mark">
        <ArrowDownLeft aria-hidden="true" />
      </span>
      {!compact && (
        <span>
          landed<span className="brand-period">.</span>
        </span>
      )}
    </span>
  );
}
