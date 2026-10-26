// 404 for unmatched routes and notFound() calls. Rendered inside the workspace shell.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/landed/primitives";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Page not found"
        description="There is nothing at this address. The link may be stale, or the record it pointed to was removed by a re-seed."
        actions={
          <>
            <Button size="sm" nativeButton={false} render={<Link href="/cases" />}>
              Verification cases
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/vendors" />}
            >
              Vendors
            </Button>
          </>
        }
      />
      <p className="text-sm text-muted-foreground">
        Looking for a case or vendor? Use the workspace search in the top bar.
      </p>
    </div>
  );
}
