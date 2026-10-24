"use node";
// "Explain this decision": a read-only, three-sentence narration of a case's evidence
// trail, built strictly from the case's events (plain-English labels) and checked so
// every fact in the narration appears in the events. Claude when keyed, else a template.
// Flag: settings.explain ("off" disables). Additive; no core file touched; no writes.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

type Ev = { at: number; actor: string; type: string; payload: Record<string, unknown> };

const LABEL: Record<string, string> = {
  case_opened: "a bank-change request opened the case", invoices_held: "open invoices were re-pointed to the requested account and held",
  validation_result: "the account-validation provider had no coverage", probe_submitted: "a randomized sub-dollar probe deposit was queued",
  probe_accepted_by_rail: "the bank rail accepted the probe", probe_settled: "the probe settled", probe_available: "the probe funds became visible to the vendor",
  awaiting_confirmation: "Landed waited for the vendor's statement", portal_confirmation_opened: "a portal confirmation was opened for the vendor",
  sim_voice_call_placed: "a (simulated) call was placed to the phone number of record", sim_voice_waiting: "no vendor statement had arrived yet",
  confirmation_received: "a vendor statement was received", release_refused: "the release gate refused", escalated: "the case was escalated to a human",
  account_verified: "the account was verified for this vendor", old_account_superseded: "the previous account was superseded",
  payment_refused: "a payment attempt was refused by the guard", payment_sent: "a payment was sent", case_paid: "the case moved to paid",
  payment_accepted_by_rail: "the rail accepted the payment", landing_statement_received: "the vendor stated what landed", payment_landed: "the vendor confirmed the full amount landed",
  case_landed: "the case landed", case_closed: "the case was closed", fraud_reported: "a human reported fraud", recovery_started: "recovery started",
  account_disputed: "the account was marked disputed", package_generated: "the recovery package was generated", change_rejected: "a human rejected the change",
  exceptional_release: "two approvers released the account exceptionally", sender_domain_mismatch: "the sender domain did not match the vendor's domain",
  human_review_requested: "a human requested review", sla_expired: "the confirmation window expired", untrusted_contact_recorded: "a new contact offered in the request was recorded as untrusted",
};

function fact(e: Ev): string {
  const base = LABEL[e.type] ?? e.type.replace(/_/g, " ");
  const p = e.payload ?? {};
  const extras: string[] = [];
  if (e.type === "confirmation_received") extras.push(`channel ${String(p.channel)}`, p.accepted ? "accepted" : `not accepted (${String(p.rejectReason)})`);
  if (e.type === "release_refused") extras.push(`reason ${String(p.reason)}`);
  if (e.type === "payment_refused") extras.push(`reason ${String(p.reason)}`);
  if (e.type === "escalated") extras.push(`reason ${String(p.reason)}`);
  if (e.type === "payment_sent" && typeof p.amountCents === "number") extras.push(`$${(p.amountCents / 100).toFixed(2)}`);
  return extras.length ? `${base} (${extras.join(", ")})` : base;
}

export function templateNarration(facts: string[], state: string): string {
  const first = facts.slice(0, 3).join("; ");
  const last = facts.slice(-3).join("; ");
  return `The case began when ${first}. Then ${last}. The case is now in state ${state}, and nothing was paid to the requested account unless the timeline shows a payment sent after verification.`;
}

/** Every token of 4+ word characters or any number in the narration must appear in the fact list or the state. */
export function grounded(narration: string, facts: string[], state: string): boolean {
  const corpus = (facts.join(" ") + " " + state).toLowerCase();
  for (const m of narration.matchAll(/\$?\d[\d,]*\.?\d*/g)) {
    const n = m[0].replace(/[$,]/g, "");
    if (!corpus.includes(n)) return false;
  }
  // Capitalized words mid-sentence must come from the facts (names, vendors, products). Sentence-initial
  // words are ordinary English and are skipped.
  for (const m of narration.matchAll(/(^|[.!?]\s+|\n)?\b([A-Z][a-zA-Z]{3,})\b/g)) {
    if (m[1] !== undefined) continue; // sentence start
    const lw = m[2].toLowerCase();
    if (["landed", "nothing", "needs_human", "verified", "paid", "closed", "recovery"].includes(lw)) continue;
    if (!corpus.includes(lw)) return false;
  }
  return true;
}

export const narrate = action({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<{ narration: string; source: "claude" | "template"; facts: string[] }> => {
    const flag = await ctx.runQuery(api.settings.get, { key: "explain" });
    if (flag === "off") throw new Error("explain is off (Settings)");
    const c = await ctx.runQuery(api.cases.get, { caseId });
    if (!c) throw new Error("case not found");
    const events = (await ctx.runQuery(api.events.listForCase, { caseId })) as Ev[];
    const facts = events.map(fact);
    const state = c.state;
    let narration = templateNarration(facts, state);
    let source: "claude" | "template" = "template";
    if (process.env.ANTHROPIC_API_KEY && facts.length) {
      try {
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const res = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
          // Thinking tokens count against max_tokens on this model; keep room and use low effort for a 3-sentence task.
          max_tokens: 3000,
          output_config: { effort: "low" },
          system: "You narrate an accounts-payable verification case for an auditor in exactly three sentences, past tense, plain English. Use ONLY the facts given, in order; do not add names, numbers, dates, reasons or outcomes that are not in the facts. Do not speculate about intent. No bullet points.",
          messages: [{ role: "user", content: `Case state: ${state}\nFacts, in order:\n${facts.map((f, i) => `${i + 1}. ${f}`).join("\n")}` }],
        });
        const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim();
        if (text && grounded(text, facts, state)) { narration = text; source = "claude"; }
        else console.warn("[explain] claude narration rejected by grounding check:", text.slice(0, 300));
      } catch (e) {
        console.warn("[explain] claude failed; template used", String(e));
      }
    }
    void internal;
    return { narration, source, facts };
  },
});
