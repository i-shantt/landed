"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Section } from "@/components/landed/primitives";
import { ClockControls } from "@/components/landed/ClockChip";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { useSettings, useSetSetting, useReseed, useSeedStatus, useEnvPresence } from "@/lib/hooks";
import { absTime } from "@/lib/format";
import { EXTRACTOR_MODE_HELP, RAIL_HELP, VOICE_HELP } from "@/lib/labels";

function ModeGroup({ name, label, options, value, help, onChange, disabledOptions }: { name: string; label: string; options: string[]; value: string; help: Record<string, string>; onChange: (v: string) => void; disabledOptions?: Record<string, string> }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-slate-900">{label}</legend>
      {options.map((o) => {
        const disabledWhy = disabledOptions?.[o];
        return (
          <label key={o} className="flex items-start gap-2 text-sm">
            <input type="radio" name={name} value={o} checked={value === o} disabled={!!disabledWhy} onChange={() => onChange(o)} className="mt-1" />
            <span>
              <span className="font-mono text-xs">{o}</span>
              <span className="block text-xs text-muted-foreground">{help[o]}{disabledWhy ? ` ${disabledWhy}` : ""}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const env = useEnvPresence();
  const seedStatus = useSeedStatus();
  const setSetting = useSetSetting();
  const reseed = useReseed();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Clock controls, modes, demo helpers, and which keys are present on the deployment." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Clock" description="All case timers run on this clock. Advancing it fires due timers immediately.">
          <ClockControls />
        </Section>
        <Section title="Modes" description="What reads email, which bank rail moves money, and how the vendor answers.">
          <div className="space-y-4">
            <ModeGroup name="extractor" label="Extractor" options={["claude", "rules", "off"]} value={settings?.extractorMode ?? "rules"} help={EXTRACTOR_MODE_HELP} onChange={(v) => setSetting({ key: "extractorMode", value: v })} disabledOptions={env && !env.ANTHROPIC_API_KEY ? { claude: "(no ANTHROPIC_API_KEY on the deployment; would fall back to rules)" } : undefined} />
            <ModeGroup name="rail" label="Bank rail" options={["sim", "nessie"]} value={settings?.rail ?? "sim"} help={RAIL_HELP} onChange={(v) => setSetting({ key: "rail", value: v })} disabledOptions={env && !env.NESSIE_KEY ? { nessie: "(no NESSIE_KEY)" } : undefined} />
            <ModeGroup name="voice" label="Voice channel" options={["sim", "vapi"]} value={settings?.voice ?? "sim"} help={VOICE_HELP} onChange={(v) => setSetting({ key: "voice", value: v })} disabledOptions={env && !env.VAPI_API_KEY ? { vapi: "(no VAPI_API_KEY; nothing would be dialed)" } : undefined} />
          </div>
        </Section>
        <Section title="Demo helpers" description="Everything here is labeled simulated on screen.">
          <div className="space-y-3 text-sm">
            <div>
              <Button variant="outline" size="sm" nativeButton={false} render={<a href="/portal/login" target="_blank" rel="noreferrer" />}>Open the vendor portal as the vendor ↗</Button>
              <p className="mt-1 text-xs text-muted-foreground">Credentials issued at onboarding: vendor slug / landed-demo.</p>
            </div>
            <div>
              <Button variant="destructive" size="sm" onClick={() => setConfirm(true)}>Re-seed fixtures…</Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Deletes every table and reloads the fixtures. {seedStatus?.seeded ? `Seeded: ${seedStatus.companyName}, ${seedStatus.vendorCount} vendors` : "Not seeded"}{settings?.seededAt ? ` at ${absTime(Number(settings.seededAt))}` : ""}.
              </p>
            </div>
            {msg && <p className="text-xs" role="status">{msg}</p>}
          </div>
        </Section>
        <Section title="Environment" description="Which server keys are present on the deployment. Names only; values never leave the server." actions={<Link href="/health" className="text-xs underline underline-offset-2">Health</Link>}>
          {!env ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {Object.entries(env).map(([k, present]) => (
                <li key={k} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs">
                  <span className="font-mono">{k}</span>
                  <span className={present ? "text-emerald-700" : "text-muted-foreground"}>{present ? "present" : "not set"}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete everything and re-seed?</DialogTitle>
            <DialogDescription>All cases, messages, payments and settings are wiped. The clock resets to demo time, offset 0. Eval results are kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { const r = await reseed({}); setMsg(`Re-seeded (deleted ${r.deleted} rows).`); setConfirm(false); } catch (e) { setMsg(`Error: ${errorMessage(e)}`); } finally { setBusy(false); } }}>Yes, re-seed</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
