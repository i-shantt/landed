"use client";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useCaseExport } from "@/lib/hooks";

export function ExportButton({ caseId }: { caseId: Id<"cases"> }) {
  const data = useCaseExport(caseId);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!data}
        onClick={() => {
          if (!data) return;
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `case-${caseId}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        Export JSON
      </Button>
      <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/cases/${caseId}/export`} target="_blank" rel="noreferrer" />}>
        Printable view
      </Button>
    </>
  );
}
