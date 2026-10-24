"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { absTime } from "@/lib/format";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

export default function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const caseId = id as Id<"cases">;
  const pkg = useQuery(api.package.getForCase, { caseId });
  const c = useQuery(api.cases.get, { caseId });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Recovery package {c?.vendor ? `· ${c.vendor.name}` : ""}</h1>
          <Link href={`/cases/${caseId}`} className="text-sm text-muted-foreground hover:underline">
            ← back to the case
          </Link>
        </div>
        {pkg && <span className="text-xs text-muted-foreground">generated {absTime(pkg.generatedAt)}</span>}
      </div>
      <Alert className="border-amber-300 bg-amber-50">
        <AlertTitle>Prepared response package.</AlertTitle>
        <AlertDescription>A human reviews, signs, and makes the call. Recovery is never guaranteed.</AlertDescription>
      </Alert>
      {pkg === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pkg === null ? (
        <p className="text-sm text-muted-foreground">No package generated yet. It is prepared automatically when a human marks fraud or when a payment misses its landing deadline.</p>
      ) : (
        <PackageBody fields={pkg.fields as PackageFields} />
      )}
    </div>
  );
}

type PackageFields = {
  amount: string;
  rail: string;
  railRef: string;
  railRefLabel: string;
  paymentDate: string;
  hoursSincePayment: number | null;
  receivingRouting: string;
  receivingLast4: string;
  sendingRouting: string;
  sendingLast4: string;
  eligibility: { international: boolean; amountAtLeast50k: boolean; within72h: boolean; killChainCriteriaMet: boolean; note: string };
  timeline: { at: number; atText: string; actor: string; type: string }[];
  sections: Record<string, string>;
};

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant="outline" className={ok ? "bg-green-100 text-green-800 border-green-200" : "bg-zinc-100 text-zinc-700"}>
      {label}: {ok ? "yes" : "no"}
    </Badge>
  );
}

function PackageBody({ fields }: { fields: PackageFields }) {
  const e = fields.eligibility;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Payment facts</CardTitle>
        </CardHeader>
        <CardContent className="text-sm grid gap-1 sm:grid-cols-2">
          <div>Amount: <span className="font-mono">{fields.amount}</span></div>
          <div>Rail: <span className="font-mono">{fields.rail}</span></div>
          <div>{fields.railRefLabel}: <span className="font-mono break-all">{fields.railRef}</span></div>
          <div>Sent: <span className="font-mono">{fields.paymentDate}</span></div>
          <div>From: <span className="font-mono">{fields.sendingRouting} · …{fields.sendingLast4}</span></div>
          <div>To: <span className="font-mono">{fields.receivingRouting} · …{fields.receivingLast4}</span></div>
          <div>Hours since payment: <span className="font-mono">{fields.hoursSincePayment ?? "n/a"}</span></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Eligibility (FBI Financial Fraud Kill Chain)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <Flag ok={e.international} label="international" />
            <Flag ok={e.amountAtLeast50k} label="≥ $50,000" />
            <Flag ok={e.within72h} label="within 72h" />
            <Flag ok={e.killChainCriteriaMet} label="all criteria met" />
          </div>
          <p className="text-muted-foreground">{e.note}</p>
        </CardContent>
      </Card>
      {Object.entries(fields.sections).map(([title, text]) => (
        <Card key={title}>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardAction>
              <CopyButton text={text} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm font-sans leading-relaxed">{text}</pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
