import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function TrustBadge({ level, superseded }: { level: string; superseded?: boolean }) {
  const cls =
    level === "record"
      ? "bg-green-100 text-green-800 border-green-200"
      : level === "discovered"
        ? "bg-zinc-100 text-zinc-700 border-zinc-200"
        : "bg-red-100 text-red-800 border-red-200";
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant="outline" className={cn("text-xs", cls)}>
        {level === "record" ? "record" : level === "discovered" ? "discovered · cross-check only" : "untrusted"}
      </Badge>
      {superseded && (
        <Badge variant="outline" className="text-xs bg-zinc-100 text-zinc-600">
          superseded
        </Badge>
      )}
    </span>
  );
}
