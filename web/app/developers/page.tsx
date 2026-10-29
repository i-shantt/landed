"use client";
import { useState } from "react";
import { Copy, KeyRound, Webhook, Inbox, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, Section, Loading } from "@/components/landed/primitives";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { useApiKeys, useApiKeyActions, useWebhookEndpoints, useWebhookDeliveries, useWebhookInbox, useWebhookActions } from "@/lib/hooks";
import { useOperator } from "@/lib/operator";
import { absTime } from "@/lib/format";

const SCOPES = ["read", "write:changes", "write:payments", "write:vendors", "files:read", "webhooks:manage"];
const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://<deployment>.convex.site";

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{children}</pre>
      <button
        type="button"
        className="absolute right-2 top-2 rounded border border-slate-700 bg-slate-900 p-1 text-slate-300 hover:text-white"
        aria-label="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        <Copy size={12} /> {copied && <span className="sr-only">copied</span>}
      </button>
    </div>
  );
}

export default function DevelopersPage() {
  const { operator, isAdmin } = useOperator();
  const keys = useApiKeys();
  const { create, revoke } = useApiKeyActions();
  const endpoints = useWebhookEndpoints();
  const deliveries = useWebhookDeliveries();
  const inbox = useWebhookInbox();
  const wh = useWebhookActions();
  const [keyName, setKeyName] = useState("ERP connector");
  const [scopes, setScopes] = useState<string[]>(["read", "write:changes"]);
  const [minted, setMinted] = useState<{ key: string; name: string } | null>(null);
  const [url, setUrl] = useState("");
  const [types, setTypes] = useState("payment_sent, payment_refused, account_verified, escalated");
  const [secretShown, setSecretShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const exampleKey = minted?.key ?? "ld_live_sk_…";

  return (
    <div className="space-y-4">
      <PageHeader title="Developers" description="REST API with scoped keys, idempotent writes and cursor pagination; signed outbound webhooks with retries. The API cannot release a payment the boundary would refuse." actions={<Button variant="outline" size="sm" nativeButton={false} render={<a href={`${SITE}/api/v1/openapi.json`} target="_blank" rel="noreferrer" />}><BookOpen size={14} /> OpenAPI 3.1</Button>} />
      {!isAdmin && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Signed in as {operator?.name ?? "nobody"}. Only an administrator can mint keys or manage endpoints; everything else here is readable.</p>}
      {msg && (
        <p className="text-sm" role="status">
          {msg}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={<span className="flex items-center gap-2"><KeyRound size={14} /> API keys</span>} description="Shown once. Stored as SHA-256. Scopes gate every route.">
          {minted && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="font-medium">Copy this key now; it will not be shown again ({minted.name}).</p>
              <code className="mt-1 block break-all font-mono">{minted.key}</code>
            </div>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!operator) return;
              try {
                const r = await create({ operatorId: operator._id, name: keyName, scopes });
                setMinted({ key: r.key, name: keyName });
              } catch (err) {
                setMsg(errorMessage(err));
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="key-name" className="text-xs">
                Name
              </Label>
              <Input id="key-name" className="h-8 w-44 text-xs" value={keyName} disabled={!isAdmin} onChange={(e) => setKeyName(e.target.value)} />
            </div>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="text-xs">Scopes</legend>
              {SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-1 rounded border px-1.5 py-1 font-mono text-[11px]">
                  <input type="checkbox" disabled={!isAdmin} checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} /> {s}
                </label>
              ))}
            </fieldset>
            <Button type="submit" size="sm" disabled={!isAdmin || !scopes.length || !keyName.trim()}>
              Create key
            </Button>
          </form>
          <ul className="mt-3 divide-y text-xs">
            {keys === undefined ? (
              <Loading />
            ) : keys.length === 0 ? (
              <li className="py-2 text-muted-foreground">No keys yet.</li>
            ) : (
              keys.map((k) => (
                <li key={k._id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    <span className="font-medium text-slate-900">{k.name}</span> <span className="font-mono text-muted-foreground">{k.prefix}…</span>
                    <span className="block text-muted-foreground">
                      {k.scopes.join(", ")} · created {absTime(k.createdAt)}
                      {k.createdBy ? ` by ${k.createdBy}` : ""} · {k.lastUsedAt ? `last used ${absTime(k.lastUsedAt)}` : "never used"}
                    </span>
                  </span>
                  {k.revokedAt ? (
                    <span className="rounded border px-1.5 text-[10px] text-muted-foreground">revoked</span>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={!isAdmin} onClick={() => operator && revoke({ operatorId: operator._id, apiKeyId: k._id }).catch((e) => setMsg(errorMessage(e)))}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))
            )}
          </ul>
        </Section>

        <Section title="Quick start" description="Submit a bank change, read the case, try to pay.">
          <div className="space-y-2">
            <Code>{`# 1. Submit a vendor bank-account change (opens a verification case, holds invoices)
curl -X POST ${SITE}/api/v1/bank-changes \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -H "Idempotency-Key: chg-2026-10-25-001" \\
  -H "Content-Type: application/json" \\
  -d '{"vendor_id":"<vendor>","routing":"011000015","account_number":"900012345678"}'`}</Code>
            <Code>{`# 2. Read the case, its risk assessment and timeline
curl ${SITE}/api/v1/cases/<case_id> -H "Authorization: Bearer ${exampleKey}"
curl ${SITE}/api/v1/cases/<case_id>/risk -H "Authorization: Bearer ${exampleKey}"`}</Code>
            <Code>{`# 3. Try to pay. Refused until the contact of record reads back the probe:
#    409 {"error":{"code":"payment_refused","reason":"destination_not_verified"}}
curl -X POST ${SITE}/api/v1/payments \\
  -H "Authorization: Bearer ${exampleKey}" -H "Content-Type: application/json" \\
  -d '{"invoice_id":"<invoice>","rail":"ach"}'`}</Code>
            <Code>{`// Verify a webhook (Node). Header: Landed-Signature: t=<unix>,v1=<hex>
const [t, v1] = sig.split(",").map((kv) => kv.split("=")[1]);
const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error("stale");
if (!crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))) throw new Error("bad signature");`}</Code>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={<span className="flex items-center gap-2"><Webhook size={14} /> Webhook endpoints</span>}
          description="Every audit event is a candidate. Signed with HMAC-SHA256; retried at 1m, 10m, 1h, 4h, 12h, 24h, 72h."
          actions={
            <>
              <Button size="sm" variant="outline" disabled={!isAdmin} onClick={() => operator && wh.createInbox({ operatorId: operator._id }).then(() => setMsg("Built-in inbox endpoint added (receives every event, signed).")).catch((e) => setMsg(errorMessage(e)))}>
                Add built-in inbox
              </Button>
              <Button size="sm" variant="outline" disabled={!isAdmin} onClick={() => operator && wh.pumpNow({ operatorId: operator._id }).then(() => setMsg("Dispatching now.")).catch((e) => setMsg(errorMessage(e)))}>
                Deliver now
              </Button>
            </>
          }
        >
          {secretShown && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
              <p className="font-medium">Signing secret (shown once):</p>
              <code className="mt-1 block break-all font-mono">{secretShown}</code>
            </div>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!operator) return;
              try {
                const r = await wh.create({ operatorId: operator._id, url: url.trim(), eventTypes: types.split(",").map((s) => s.trim()).filter(Boolean) });
                setSecretShown(r.secret);
                setUrl("");
              } catch (err) {
                setMsg(errorMessage(err));
              }
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="wh-url" className="text-xs">
                HTTPS URL
              </Label>
              <Input id="wh-url" className="h-8 w-64 text-xs" placeholder="https://erp.example.com/landed" value={url} disabled={!isAdmin} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wh-types" className="text-xs">
                Event types (comma separated, or *)
              </Label>
              <Input id="wh-types" className="h-8 w-72 text-xs" value={types} disabled={!isAdmin} onChange={(e) => setTypes(e.target.value)} />
            </div>
            <Button type="submit" size="sm" disabled={!isAdmin || !url.trim()}>
              Add endpoint
            </Button>
          </form>
          <ul className="mt-3 divide-y text-xs">
            {endpoints === undefined ? (
              <Loading />
            ) : endpoints.length === 0 ? (
              <li className="py-2 text-muted-foreground">No endpoints. Add the built-in inbox to see signed deliveries end to end.</li>
            ) : (
              endpoints.map((e) => (
                <li key={e._id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-slate-900">{e.url}</span>
                    <span className="block text-muted-foreground">
                      {e.eventTypes.join(", ")} · secret {e.secretHint} · {e.stats.delivered} delivered · {e.stats.pending} pending · {e.stats.exhausted} exhausted {e.active ? "" : "· paused"}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={!isAdmin} onClick={() => operator && wh.sendTest({ operatorId: operator._id, endpointId: e._id }).then((r) => setMsg(r.ok ? `Test delivered (HTTP ${r.status}).` : `Test failed: ${r.error ?? `HTTP ${r.status}`}`))}>
                      Send test
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!isAdmin} onClick={() => operator && wh.setActive({ operatorId: operator._id, endpointId: e._id, active: !e.active })}>
                      {e.active ? "Pause" : "Resume"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!isAdmin} onClick={() => operator && wh.remove({ operatorId: operator._id, endpointId: e._id })}>
                      Delete
                    </Button>
                  </span>
                </li>
              ))
            )}
          </ul>
          {deliveries && deliveries.length > 0 && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Recent deliveries ({deliveries.length})</summary>
              <ul className="mt-1 divide-y">
                {deliveries.slice(0, 20).map((d) => (
                  <li key={d._id} className="flex items-center justify-between gap-2 py-1">
                    <span className="font-mono">{d.eventType}</span>
                    <span className={d.status === "delivered" ? "text-emerald-800" : d.status === "exhausted" ? "text-red-800" : "text-amber-800"}>
                      {d.status} · attempt {d.attempt}
                      {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ""}
                      {d.lastError ? ` · ${d.lastError}` : ""}
                    </span>
                    <span className="font-mono text-muted-foreground">{absTime(d.deliveredAt ?? d.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Section>

        <Section title={<span className="flex items-center gap-2"><Inbox size={14} /> Signed inbox</span>} description="What a customer's receiver sees: the raw event and whether the signature verified. Demo receiver built into this deployment.">
          {inbox === undefined ? (
            <Loading />
          ) : inbox.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing received yet. Add the built-in inbox endpoint, then trigger an event (send a payment, open a case) and click “Deliver now”.</p>
          ) : (
            <ul className="divide-y text-xs">
              {inbox.slice(0, 10).map((r) => (
                <li key={r._id} className="py-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono">
                      {r.eventType} <span className="text-muted-foreground">{r.eventId}</span>
                    </span>
                    <span className={r.signatureValid ? "text-emerald-800" : "text-red-800"}>{r.signatureValid ? "signature valid" : "signature INVALID"}</span>
                    <span className="font-mono text-muted-foreground">{absTime(r.receivedAt)}</span>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">payload</summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[10px]">{(() => {
                      try {
                        return JSON.stringify(JSON.parse(r.body), null, 2);
                      } catch {
                        return r.body;
                      }
                    })()}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
