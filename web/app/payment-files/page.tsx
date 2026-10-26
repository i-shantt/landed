"use client";
import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section, Loading, EmptyState } from "@/components/landed/primitives";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { usePaymentFiles, useBuildPaymentFile, usePaymentRun } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { usd, absTime } from "@/lib/format";

const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://<deployment>.convex.site";

export default function PaymentFilesPage() {
  const files = usePaymentFiles();
  const run = usePaymentRun();
  const build = useBuildPaymentFile();
  const { operator } = useOperator();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const payable = run ? run.totals.payable : 0;

  async function make(format: "nacha" | "pain.001") {
    if (!operator) return;
    setBusy(format);
    setMsg(null);
    try {
      const r = await build({ operatorId: operator._id, format });
      setMsg(`${format === "nacha" ? "Nacha ACH" : "ISO 20022 pain.001"} file built: ${r.entryCount} entries, ${usd(r.totalCents)}. SHA-256 ${r.sha256.slice(0, 12)}…`);
      setOpen(r.id);
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payment files"
        description="Bank-ready files built only from lines the guard and policy would pay right now. The full file (with account numbers) stays on the server and is fetched by your bank connector through the API; the browser sees a masked preview."
        actions={
          <>
            <Button size="sm" variant="outline" disabled={!operator || busy !== null || payable === 0} onClick={() => make("nacha")}>
              <FileText size={14} /> Build Nacha ACH (CCD)
            </Button>
            <Button size="sm" variant="outline" disabled={!operator || busy !== null || payable === 0} onClick={() => make("pain.001")}>
              <FileText size={14} /> Build ISO 20022 pain.001
            </Button>
          </>
        }
      />
      <p className="text-xs text-muted-foreground">
        {run ? `${payable} payable line${payable === 1 ? "" : "s"} (${usd(run.totals.payableCents)}) would go into a new file.` : "Loading the payment run…"} Building a file moves no money. Verified destinations only: an unverified account cannot appear in a file any more than it can be paid from the dashboard.
      </p>
      {msg && (
        <p className="text-sm" role="status">
          {msg}
        </p>
      )}
      {files === undefined ? (
        <Loading />
      ) : files.length === 0 ? (
        <EmptyState title="No files yet" description="Build one from the current payable lines." action={{ label: "Open the payment run", href: "/payment-run" }} />
      ) : (
        <div className="space-y-3">
          {files.map((f) => (
            <Section
              key={f._id}
              title={
                <span className="flex items-center gap-2">
                  {f.format === "nacha" ? "Nacha ACH" : "ISO 20022 pain.001.001.03"}
                  <span className="rounded border px-1.5 text-[10px] font-normal text-muted-foreground">{f.entryCount} entries · {usd(f.totalCents)}</span>
                </span>
              }
              description={`Built ${absTime(f.createdAt)} by ${f.createdBy} · SHA-256 ${f.sha256}`}
              actions={
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === f._id ? null : f._id)}>
                  {open === f._id ? "Hide preview" : "Masked preview"}
                </Button>
              }
            >
              <p className="text-xs text-muted-foreground">
                Download the full file with a <span className="font-mono">files:read</span> key: <code className="font-mono">GET {SITE}/api/v1/payment-files/{f._id}</code>
              </p>
              {open === f._id && <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">{f.previewMasked}</pre>}
            </Section>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Formats: Nacha 94-character records, batch SEC code CCD, service class 220 (credits), entry hash and blocking per the ACH file specification; probe deposits would use <span className="font-mono">ACCTVERIFY</span> Micro-Entries. ISO 20022 pain.001.001.03 with USABA clearing identifiers. See <Link href="/compliance" className="underline underline-offset-2">controls matrix</Link>.
      </p>
    </div>
  );
}
