"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Section, Loading } from "@/components/landed/primitives";
import { PortalFrame } from "@/components/landed/PortalFrame";
import { portalLogout } from "@/lib/portal-session";
import { usePortalRequests } from "@/lib/use-portal-session";
import { absTime } from "@/lib/format";

export default function PortalHome() {
  const router = useRouter();
  const { loading, data, signedIn } = usePortalRequests();
  if (loading && signedIn === undefined) return <Loading />;
  if (signedIn === false || !data) {
    return (
      <PortalFrame vendorName="Vendor">
        <p className="text-sm">You are not signed in to the vendor portal.</p>
        <Button nativeButton={false} render={<Link href="/portal/login" />}>Sign in</Button>
      </PortalFrame>
    );
  }
  return (
    <PortalFrame
      vendorName={data.vendorName}
      subtitle={`Confirmation requests from ${data.companyName || "your customer"}`}
      actions={
        <Button size="sm" variant="outline" onClick={async () => { await portalLogout(); router.push("/portal/login"); }}>
          Sign out
        </Button>
      }
    >
      <Section title="Open confirmation requests" description="Each request asks you to read the exact amount of a small deposit from your bank statement.">
        {data.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to confirm right now.</p>
        ) : (
          <ul className="divide-y">
            {data.requests.map((r) => (
              <li key={r.token} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <div>
                    New account ending <span className="font-mono">…{r.accountLast4}</span> (routing <span className="font-mono">{r.routing}</span>)
                  </div>
                  <div className="text-xs text-muted-foreground">{r.attemptsLeft} attempt(s) left · expires {absTime(r.expiresAt)}</div>
                </div>
                <Button size="sm" nativeButton={false} render={<Link href={`/confirm/${r.token}`} />}>Confirm deposit</Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PortalFrame>
  );
}
