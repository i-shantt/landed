"use client";
import { use, useState } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, Section, Loading, KV } from "@/components/landed/primitives";
import { usePackage, useCase } from "@/lib/hooks";
import { absTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="xs" variant="outline" aria-label="Copy section" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard unavailable */ } }}>
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

type PackageFields = {
  amount: string; rail: string; railRef: string; railRefLabel: string; paymentDate: string; hoursSincePayment: number | null;
  receivingRouting: string; receivingLast4: string; sendingRouting: string; sendingLast4: string;
  eligibility: { international: boolean; amountAtLeast50k: boolean; within72h: boolean; killChainCriteriaMet: boolean; note: string };
  sections: Record<string, string>;
};

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cn("rounded border px-1.5 text-[11px]", ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600")}>{label}: {ok ? "yes" : "no"}</span>;
}

export default function PackagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const caseId = id as Id<"cases">;
  const pkg = usePackage(caseId);
  const c = useCase(caseId);
  const f = pkg?.fields as PackageFields | undefined;
  return (
    <div className="space-y-4">
      <PageHeader title={`Recovery package${c?.vendor ? ` · ${c.vendor.name}` : ""}`} description={<Link href={`/cases/${caseId}`} className="hover:underline">← back to the case</Link>} actions={pkg ? <span className="font-mono text-xs tabular-nums text-muted-foreground">generated {absTime(pkg.generatedAt)}</span> : undefined} />
      <Alert className="border-amber-300 bg-amber-50 text-amber-900">
        <AlertTitle>Prepared response package.</AlertTitle>
        <AlertDescription className="text-amber-900">A human reviews, signs, and makes the call. Recovery is never guaranteed.</AlertDescription>
      </Alert>
      {pkg === undefined ? <Loading /> : pkg === null || !f ? (
        <p className="text-sm text-muted-foreground">No package generated yet. It is prepared automatically when a human marks fraud or when a payment misses its landing deadline.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Payment facts">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <KV k="Amount" v={f.amount} mono />
              <KV k="Rail" v={f.rail} mono />
              <KV k={f.railRefLabel} v={<span className="break-all">{f.railRef}</span>} mono />
              <KV k="Sent" v={f.paymentDate} mono />
              <KV k="From" v={`${f.sendingRouting} · …${f.sendingLast4}`} mono />
              <KV k="To" v={`${f.receivingRouting} · …${f.receivingLast4}`} mono />
              <KV k="Hours since payment" v={f.hoursSincePayment ?? "n/a"} mono />
            </dl>
          </Section>
          <Section title="Eligibility (FBI Financial Fraud Kill Chain)" description="As published; confirm with your bank and IC3.">
            <div className="flex flex-wrap gap-1.5">
              <Flag ok={f.eligibility.international} label="international" />
              <Flag ok={f.eligibility.amountAtLeast50k} label="≥ $50,000" />
              <Flag ok={f.eligibility.within72h} label="within 72h" />
              <Flag ok={f.eligibility.killChainCriteriaMet} label="all criteria met" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{f.eligibility.note}</p>
          </Section>
          {Object.entries(f.sections).map(([title, text]) => (
            <Section key={title} title={title} actions={<CopyButton text={text} />} className={title === "Timeline" ? "lg:col-span-2" : undefined}>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">{text}</pre>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
