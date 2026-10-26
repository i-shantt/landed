"use client";
import Link from "next/link";
import { PageHeader, Section, KV, Loading } from "@/components/landed/primitives";
import { useHealth } from "@/lib/hooks";
import { absTime } from "@/lib/format";

export default function HealthPage() {
  const h = useHealth();
  if (!h)
    return (
      <div className="space-y-4">
        <PageHeader title="System health" description="Deployment, seed, demo clock, timers, modes and key presence." />
        <Loading label="Reading deployment health…" />
      </div>
    );
  const yn = (b: boolean) => (b ? "yes" : "no");
  return (
    <div className="space-y-4">
      <PageHeader title="System health" description="Deployment, seed, demo clock, timers, modes and key presence. The runbook points here first if anything looks stuck.">
        <Link href="/settings" className="text-xs underline underline-offset-2">Settings</Link>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Deployment and seed">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <KV k="Deployment" v={h.deployment ?? "unknown"} mono />
            <KV k="Company" v={h.company ?? "not seeded"} />
            <KV k="Seeded at" v={h.seededAt ? absTime(h.seededAt) : "never"} mono />
            <KV k="Demo cases seeded at" v={h.demoSeededAt ? absTime(h.demoSeededAt) : "none"} mono />
            <KV k="Cases" v={`${h.cases.total} total · ${h.cases.open} open · ${h.cases.needsHuman} needing a human`} />
          </dl>
        </Section>
        <Section title="Clock and timers">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <KV k="Clock mode" v={h.clock.mode} mono />
            <KV k="Demo time" v={absTime(h.clock.now)} mono />
            <KV k="Offset" v={`${(h.clock.offsetMs / 3600_000).toFixed(1)} h`} mono />
            <KV k="Last timer fired (due at)" v={h.lastTimerFiredDueAt ? absTime(h.lastTimerFiredDueAt) : "none yet"} mono />
            <KV k="Unfired timers" v={h.unfiredTimers} mono />
            <KV k="Next timer" v={h.nextTimer ? `${h.nextTimer.kind} at ${absTime(h.nextTimer.dueAt)}` : "none"} mono />
          </dl>
        </Section>
        <Section title="Modes">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <KV k="Extractor" v={h.modes.extractor} mono />
            <KV k="Rail" v={h.modes.rail} mono />
            <KV k="Voice" v={h.modes.voice} mono />
            <KV k="Judge mode" v={h.modes.judgeMode} mono />
          </dl>
        </Section>
        <Section title="Keys present (names only)">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <KV k="Anthropic" v={yn(h.keys.anthropic)} />
            <KV k="Nessie" v={yn(h.keys.nessie)} />
            <KV k="Vapi" v={yn(h.keys.vapi)} />
            <KV k="Account HMAC key" v={yn(h.keys.hmac)} />
            <KV k="Account encryption key" v={yn(h.keys.enc)} />
            <KV k="Eval key" v={yn(h.keys.evalKey)} />
            <KV k="Probe-amount endpoint" v={h.probeAmountEndpoint} />
          </dl>
        </Section>
      </div>
    </div>
  );
}
