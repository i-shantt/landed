"use node";
// Claude drafts the three prose sections of the recovery package from the
// deterministic fields only. It is told not to invent numbers; package.ts then
// verifies every number in the prose appears in the fields and falls back to the
// templates if not. This action cannot touch cases, accounts, or payments (I5).
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";

export const draft = internalAction({
  args: { fields: v.any() },
  handler: async (_ctx, { fields }): Promise<Record<string, string>> => {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
    const f = fields as Record<string, unknown>;
    const { timeline: _t, sections: _s, ...facts } = f;
    const res = await client.messages.create({
      model,
      max_tokens: 4000,
      system: [
        "You draft a business-email-compromise recovery package for an accounts payable team.",
        "Use ONLY the facts provided as JSON. Do not invent, round, or infer any number, date, name, account digit, or reference. If a fact is missing, write 'n/a'.",
        "Write three sections: a bank fraud-line phone script (first person, what AP says when calling their bank's fraud line), an indemnification letter draft (formal, to the receiving institution's fraud department, with signature line), and an FBI IC3 complaint narrative (third person, factual).",
        "Say 'recovery is never guaranteed' once. Never claim the funds will be returned.",
        "Respond with JSON only: {\"Bank fraud-line script\": string, \"Indemnification letter draft\": string, \"IC3 narrative\": string}.",
      ].join(" "),
      messages: [{ role: "user", content: `Facts:\n${JSON.stringify(facts, null, 2)}` }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON in response");
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of ["Bank fraud-line script", "Indemnification letter draft", "IC3 narrative"]) {
      if (typeof parsed[k] !== "string") throw new Error(`missing section ${k}`);
      out[k] = parsed[k] as string;
    }
    return out;
  },
});
