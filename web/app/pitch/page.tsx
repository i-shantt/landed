"use client";
// In-app pitch deck: 7 full-viewport slides, keyboard-navigable, printable one slide per page.
// Numbers are sourced from README.md / DEVPOST.md and are not to be edited here.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSettings } from "@/lib/hooks";
import { PermissionsTable } from "@/components/landed/PermissionsTable";
import { cn } from "@/lib/utils";

const TOTAL = 7;

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border bg-card px-5 py-4">
      <div className="font-mono text-3xl tabular-nums text-slate-900 md:text-4xl">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
    </div>
  );
}

function SlideFrame({ n, title, children, wide = false }: { n: number; title?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className="pitch-slide flex min-h-[100dvh] w-full flex-col px-10 py-10 md:px-16 md:py-12" aria-label={`Slide ${n} of ${TOTAL}`}>
      {title && <h2 className="mb-6 text-2xl font-semibold tracking-tight text-slate-900 md:text-4xl">{title}</h2>}
      <div className={cn("flex min-h-0 flex-1 flex-col justify-center", wide ? "max-w-none" : "max-w-5xl")}>{children}</div>
    </section>
  );
}

function parseDemo(raw: string | undefined): { caseId: string; label: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as { caseId: string; label: string }[]).filter((x) => x && typeof x.caseId === "string") : [];
  } catch {
    return [];
  }
}

export default function PitchPage() {
  const [i, setI] = useState(0);
  const [help, setHelp] = useState(false);
  const settings = useSettings();
  const demo = useMemo(() => parseDemo(settings?.demoCases), [settings?.demoCases]);
  const fraud = demo.find((d) => /^Fraud/i.test(d.label))?.caseId ?? null;

  const go = useCallback((n: number) => setI(Math.max(0, Math.min(TOTAL - 1, n))), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); setI((x) => Math.min(TOTAL - 1, x + 1)); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
      else if (e.key === "Home") { e.preventDefault(); setI(0); }
      else if (e.key === "End") { e.preventDefault(); setI(TOTAL - 1); }
      else if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === "Escape") setHelp(false);
      else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slides = [
    <SlideFrame key={1} n={1}>
      <p className="text-sm uppercase tracking-wide text-slate-500">Cal Hacks 13.0</p>
      <h1 className="mt-2 text-6xl font-semibold tracking-tight text-slate-900 md:text-7xl">Landed</h1>
      <p className="mt-4 text-2xl text-slate-700 md:text-3xl">No payment to an account the vendor hasn&apos;t confirmed.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <Stat value="$3.05B" label="BEC losses reported to FBI IC3 in 2025 (24,768 complaints)" />
        <Stat value="74%" label="of organizations hit by BEC in 2025 (AFP 2026 survey)" />
        <Stat value="72 h" label="after which recovery odds collapse" />
      </div>
    </SlideFrame>,
    <SlideFrame key={2} n={2} title="The attack, three ways">
      <ol className="space-y-5 text-xl text-slate-800 md:text-2xl">
        <li><span className="font-mono text-base text-slate-500 md:text-lg">1 </span>A compromised vendor inbox: DMARC-clean, inside the real invoice thread, &ldquo;we switched banks.&rdquo;</li>
        <li><span className="font-mono text-base text-slate-500 md:text-lg">2 </span>A lookalike domain or display name, with the same message and a never-seen account.</li>
        <li><span className="font-mono text-base text-slate-500 md:text-lg">3 </span>A fooled clerk who types the attacker&apos;s account into the vendor record by hand. No email, no AI.</li>
      </ol>
      <p className="mt-8 text-lg text-slate-600">The invoice is real. The vendor is real. Only the destination changed.</p>
    </SlideFrame>,
    <SlideFrame key={3} n={3} title="What Landed does">
      <ul className="space-y-4 text-xl text-slate-800 md:text-2xl">
        <li>Every bank-account change becomes a verification case.</li>
        <li>Open invoices follow the request and are blocked until the case is verified.</li>
        <li>A randomized sub-dollar probe deposit is sent to the new account.</li>
        <li>Only the contact of record&apos;s read-back of that amount releases the account, in one database transaction.</li>
        <li>After payment, Landed checks the money landed; if not, it prepares the recovery package.</li>
      </ul>
    </SlideFrame>,
    <SlideFrame key={4} n={4} title="The moment" wide>
      {fraud ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="mb-3 text-base text-slate-600">
            Live replay of the fraud demo case: the vendor of record saw no deposit, the attacker&apos;s &ldquo;we received it&rdquo; email was ignored, Pay was refused.
            <Link href={`/cases/${fraud}?autoplay=1`} className="ml-2 underline underline-offset-2">Open full screen</Link>
          </p>
          <iframe title="Captioned replay of the fraud demo case" src={`/cases/${fraud}?autoplay=1`} className="min-h-[60vh] w-full flex-1 rounded-md border bg-card print:hidden" />
          <p className="hidden text-sm text-slate-600 print:block">Replay available at /cases/{fraud}?autoplay=1</p>
        </div>
      ) : (
        <p className="text-xl text-slate-700">Re-seed the fixtures (Settings → Re-seed) to create the demo cases; the fraud case replays here.</p>
      )}
    </SlideFrame>,
    <SlideFrame key={5} n={5} title="What the agent can and cannot call" wide>
      <p className="mb-3 text-base text-slate-600">Permissions as enforced in the database, not as prompt instructions.</p>
      <div className="text-sm"><PermissionsTable compact /></div>
    </SlideFrame>,
    <SlideFrame key={6} n={6} title="Real vs. simulated, and the numbers" wide>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-medium text-slate-900">Real</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-base text-slate-800 md:text-lg">
            <li>The Convex engine and the eight invariants</li>
            <li>Versioned accounts, HMAC-hashed and AES-256-GCM encrypted</li>
            <li>Append-only, redacted audit log</li>
            <li>Rules and Claude extractors (PDFs as documents)</li>
            <li>Vendor portal login; eval harness; Nessie transfers</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-medium text-slate-900">Simulated (labeled on screen)</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-base text-slate-800 md:text-lg">
            <li>The bank (an in-database ledger unless Nessie is selected)</li>
            <li>Time (a demo clock drives the same timers)</li>
            <li>Vendor answers (a human types what the vendor sees; voice channel written, not dialed)</li>
            <li>Email authentication results; the vendor&apos;s bank statement</li>
          </ul>
        </div>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <Stat value="91" label="unit and invariant tests" />
        <Stat value="30/30" label="eval scenario runs (extractor on and off)" />
        <Stat value="21/21" label="through the Claude extractor" />
        <Stat value="0" label="false releases" />
      </div>
      <p className="mt-5 text-sm text-slate-600">These are results on scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud.</p>
    </SlideFrame>,
    <SlideFrame key={7} n={7} title="Prior art, and what Landed adds" wide>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-medium text-slate-900">Prior art</h3>
          <ul className="space-y-1.5 text-base text-slate-800 md:text-lg">
            <li><span className="font-medium">Trouvé</span>: hold-by-policy plus an automated call with a yes/no transcript judge.</li>
            <li><span className="font-medium">Trustpair, Eftsure</span>: account validation against networks of previously verified vendors.</li>
            <li><span className="font-medium">Charted</span> and similar: detect suspicious change requests, stop at an alert.</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-medium text-slate-900">Landed adds</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-base text-slate-800 md:text-lg">
            <li>A number read-back instead of yes/no</li>
            <li>A database release gate bound to vendor and account version</li>
            <li>The landing check after payment</li>
            <li>The recovery package</li>
            <li>An eval that includes the legitimate and AI-off paths</li>
          </ul>
        </div>
      </div>
      <p className="mt-8 text-base text-slate-700">Built with: Convex, Next.js, Claude, Nessie, Vapi + Cartesia (written), Playwright.</p>
      <p className="mt-1 text-base text-slate-700">Tracks: Hyphenate, Microsoft, Convex, Capital One, Cartesia (conditional), Anthropic.</p>
      <p className="mt-6 text-sm text-slate-500">Team: Meridian Outdoor Co. demo · <Link href="/judge" className="underline underline-offset-2">Run your own scenario</Link></p>
    </SlideFrame>,
  ];

  return (
    <div className="pitch-root min-h-[100dvh] bg-background text-slate-900">
      <style>{`
        @media print {
          .pitch-slide { break-after: page; page-break-after: always; min-height: auto; height: 100vh; }
          .pitch-nav, .pitch-help { display: none !important; }
          .pitch-stage { position: static !important; height: auto !important; overflow: visible !important; }
        }
      `}</style>
      <div className="pitch-stage">
        {slides.map((s, idx) => (
          <div key={idx} className={cn(idx === i ? "block" : "hidden", "print:block")}>{s}</div>
        ))}
      </div>
      <nav className="pitch-nav fixed bottom-4 right-6 flex items-center gap-2 rounded-md border bg-card/95 px-3 py-1.5 text-xs text-slate-600 shadow-sm" aria-label="Slide navigation">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40" aria-label="Previous slide">←</button>
        <span className="font-mono tabular-nums" aria-live="polite">{i + 1} / {TOTAL}</span>
        <button type="button" onClick={() => go(i + 1)} disabled={i === TOTAL - 1} className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40" aria-label="Next slide">→</button>
        <button type="button" onClick={() => setHelp((h) => !h)} className="rounded px-1.5 py-0.5 hover:bg-muted" aria-label="Show keyboard shortcuts">?</button>
        <Link href="/cases" className="rounded px-1.5 py-0.5 hover:bg-muted" aria-label="Exit the pitch deck">Exit</Link>
      </nav>
      {help && (
        <div className="pitch-help fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40" onClick={() => setHelp(false)} role="dialog" aria-label="Keyboard shortcuts">
          <div className="rounded-md border bg-card p-5 text-sm shadow" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-medium">Keys</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
              <dt>→ / Space</dt><dd className="font-sans">next slide</dd>
              <dt>←</dt><dd className="font-sans">previous slide</dd>
              <dt>Home / End</dt><dd className="font-sans">first / last slide</dd>
              <dt>f</dt><dd className="font-sans">fullscreen</dd>
              <dt>?</dt><dd className="font-sans">this map</dd>
              <dt>Esc</dt><dd className="font-sans">close</dd>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Print (Cmd+P) gives one slide per page.</p>
          </div>
        </div>
      )}
    </div>
  );
}
