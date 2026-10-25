"use client";
import {
  Suspense,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaseStatusBadge } from "@/components/landed/badges";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import {
  CaseTimeline,
  type TimelineEvent,
} from "@/components/landed/CaseTimeline";
import {
  ProbeCard,
  AccountTable,
  ConfirmationList,
  PaymentCard,
} from "@/components/landed/CaseCards";
import {
  CaseActions,
  SimulateVendorAnswer,
} from "@/components/landed/CaseActions";
import { ExplainPanel } from "@/components/landed/ExplainPanel";
import { NessiePanel } from "@/components/landed/NessiePanel";
import { ExportButton } from "@/components/landed/ExportButton";
import { FastForward } from "@/components/landed/FastForward";
import { Term } from "@/components/landed/Term";
import { captionFor } from "@/lib/captions";
import {
  useCase,
  useCaseEvents,
  useProbe,
  useConfirmations,
  useNow,
} from "@/lib/hooks";
import { absTime, countdown } from "@/lib/format";
import { triggerLabel, humanReasonLabel, caseSummary } from "@/lib/labels";

export default function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <CaseView caseId={id as Id<"cases">} />
    </Suspense>
  );
}

function CaseView({ caseId }: { caseId: Id<"cases"> }) {
  const sp = useSearchParams();
  const autoplay = sp.get("autoplay") === "1";
  const replay = sp.get("replay") === "1" || autoplay;
  const c = useCase(caseId);
  const live = useCaseEvents(caseId, !replay);
  const probe = useProbe(caseId);
  const confirmations = useConfirmations(caseId);
  const now = useNow();
  const [filter, setFilter] = useState("");

  if (c === undefined) return <Loading />;
  if (c === null)
    return <p className="text-sm text-red-700">Case not found.</p>;

  return (
    <div className="space-y-4">
      <Link href="/cases" className="ops-back-link">
        <ArrowLeft size={13} />
        All verification cases
      </Link>
      <PageHeader
        title={
          <>
            {c.vendor ? (
              <Link
                href={`/vendors/${c.vendor._id}`}
                className="hover:underline"
              >
                {c.vendor.name}
              </Link>
            ) : (
              "Unknown vendor"
            )}
            <CaseStatusBadge state={c.state} showToken={false} />
            {replay && (
              <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 text-[11px] text-indigo-900">
                {autoplay ? "Autoplay" : "Replay"}
              </span>
            )}
          </>
        }
        description={
          <span>
            {triggerLabel(c.triggerType)} · opened{" "}
            <span className="font-mono tabular-nums">
              {absTime(c.openedAt)}
            </span>
            {c.state === "AWAITING_CONFIRMATION" && c.slaDeadlineAt ? (
              <>
                {" "}
                · SLA{" "}
                <span className="font-mono tabular-nums">
                  {countdown(c.slaDeadlineAt, now)}
                </span>
              </>
            ) : null}
          </span>
        }
        actions={
          replay ? (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={`/cases/${caseId}`} />}
            >
              Exit replay
            </Button>
          ) : (
            <>
              <ExportButton caseId={caseId} />
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/cases/${caseId}?replay=1`} />}
              >
                Replay timeline
              </Button>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={`/cases/${caseId}?autoplay=1`} />}
              >
                Play with captions
              </Button>
            </>
          )
        }
      >
        <div className="case-detail-summary">
          <ShieldCheck size={20} />
          <p>
            <SummaryWithTerms text={caseSummary(c.state, c.humanReason)} />
          </p>
        </div>
        {c.humanReason && c.state === "NEEDS_HUMAN" && (
          <p className="text-sm text-amber-900">
            Needs a human:{" "}
            <span className="font-medium">
              {humanReasonLabel(c.humanReason)}
            </span>
          </p>
        )}
      </PageHeader>

      <div className="case-detail-grid grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section
          className="case-detail-timeline"
          title="Timeline"
          description="Append-only audit log. Probe amounts are redacted everywhere."
          actions={
            !replay ? (
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter events…"
                aria-label="Filter timeline events"
                className="h-7 w-44 text-xs"
              />
            ) : undefined
          }
        >
          {replay ? (
            <ReplayTimeline caseId={caseId} now={now} captions={autoplay} />
          ) : (
            <CaseTimeline
              events={(live ?? []) as TimelineEvent[]}
              now={now}
              filter={filter}
            />
          )}
        </Section>

        <div className="case-detail-sidebar space-y-4">
          <AccountTable
            newAccount={c.newAccount}
            oldAccount={c.oldAccount}
            amountAtStakeCents={c.amountAtStakeCents}
          />
          {!replay && (
            <CaseActions
              caseId={caseId}
              state={c.state}
              openInvoices={c.openInvoices}
            />
          )}
          <ProbeCard probe={probe}>
            {!replay && c.state !== "PAID" ? (
              <FastForward caseId={caseId} state={c.state} />
            ) : null}
          </ProbeCard>
          <div className="rounded-md border bg-card px-4 py-2.5 text-xs text-slate-700">
            Validation provider:{" "}
            <span className="font-medium">
              {c.validationProviderResult === "no_coverage"
                ? "no coverage → probe"
                : (c.validationProviderResult ??
                  "not consulted (escalated first)")}
            </span>
          </div>
          <PaymentCard payment={c.payment} now={now}>
            {!replay && c.state === "PAID" ? (
              <FastForward caseId={caseId} state={c.state} />
            ) : null}
          </PaymentCard>

          <ConfirmationList confirmations={confirmations} />
          {!replay && (
            <details className="ops-inline-tools">
              <summary>Demo and diagnostic tools</summary>
              <div className="space-y-4 pt-4">
                <SimulateVendorAnswer caseId={caseId} state={c.state} />
                <ExplainPanel caseId={caseId} />
                <NessiePanel caseId={caseId} />
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

/** Wraps the first occurrence of a few jargon words in the summary with hover definitions. */
function SummaryWithTerms({ text }: { text: string }) {
  const keys: [RegExp, Parameters<typeof Term>[0]["k"]][] = [
    [/\bprobe\b/i, "probe"],
    [/\bcontact of record\b/i, "contact_of_record"],
    [/\bSLA\b/, "sla"],
    [/\bACH\b/, "ach"],
    [/\blanding\b/i, "landing"],
  ];
  for (const [re, k] of keys) {
    const m = text.match(re);
    if (m && m.index !== undefined) {
      return (
        <>
          {text.slice(0, m.index)}
          <Term k={k}>{m[0]}</Term>
          {text.slice(m.index + m[0].length)}
        </>
      );
    }
  }
  return <>{text}</>;
}

/** Reads the events once, freezes them, and plays them back at 10x (no live subscription afterwards). */
function ReplayTimeline({
  caseId,
  now,
  captions,
}: {
  caseId: Id<"cases">;
  now: number;
  captions?: boolean;
}) {
  const live = useCaseEvents(caseId, true);
  if (!live) return <Loading label="Loading once…" />;
  return (
    <ReplayPlayer
      events={live as TimelineEvent[]}
      now={now}
      captions={!!captions}
    />
  );
}

function usePrefersReducedMotion() {
  // useSyncExternalStore keeps the media query in sync without setState-in-effect.
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
      mq?.addEventListener?.("change", cb);
      return () => mq?.removeEventListener?.("change", cb);
    },
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    () => false,
  );
}

function ReplayPlayer({
  events,
  now,
  captions,
}: {
  events: TimelineEvent[];
  now: number;
  captions: boolean;
}) {
  const [frozen] = useState(events);
  const [run, setRun] = useState(0);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();
  // Captions pace slower (2.4s per event) so a viewer can read them; plain replay runs at 10x (300ms).
  const interval = captions ? 2400 : 300;
  useEffect(() => {
    if (reduced || paused) return;
    const timer = setInterval(
      () => setTick((t) => Math.min(t + 1, frozen.length)),
      interval,
    );
    return () => clearInterval(timer);
  }, [run, reduced, paused, interval, frozen.length]);
  const shown =
    reduced && !captions ? frozen.length : Math.min(tick, frozen.length);
  const current = shown > 0 ? frozen[shown - 1] : null;
  const caption =
    captions && current ? captionFor(current.type, current.payload) : null;
  const step = (d: number) =>
    setTick((t) => Math.max(0, Math.min(frozen.length, t + d)));
  return (
    <div className="relative space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">
          {shown}/{frozen.length} events · {captions ? "captioned" : "10x"} ·
          offline (no live subscription)
        </span>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            setTick(0);
            setPaused(false);
            setRun((r) => r + 1);
          }}
        >
          Restart
        </Button>
        {captions && !reduced && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
        )}
        {(reduced || paused) && (
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() => step(-1)}
              aria-label="Previous event"
            >
              Prev
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => step(1)}
              aria-label="Next event"
            >
              Next
            </Button>
          </>
        )}
        {reduced && <span>(reduced motion: step manually)</span>}
      </div>
      <CaseTimeline events={frozen.slice(0, shown)} now={now} />
      {captions && (
        <div
          className="pointer-events-none sticky bottom-4 z-20 flex justify-center"
          aria-live="polite"
        >
          {caption && (
            <p className="pointer-events-auto max-w-2xl rounded-full bg-slate-900/95 px-5 py-2.5 text-center text-sm text-white shadow-lg">
              {caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
