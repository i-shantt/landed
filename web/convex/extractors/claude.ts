"use node";
// Claude extractor: one tool-forced messages.create call. Only the current
// vendor's routing and last four are ever sent. Never any other vendor's data.
import Anthropic from "@anthropic-ai/sdk";
import { extractWithRules, type Extraction } from "./rules";

export const TOOL = {
  name: "extractInstructionChange",
  description: "Extract any change to where this vendor should be paid. Call this tool exactly once for every message, including when nothing changed (changed=false). Copy routing and account digits verbatim from the message or attachment.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      changed: { type: "boolean", description: "true if the message instructs payment to a different routing/account than the vendor record" },
      newRouting: { type: ["string", "null"], description: "9-digit ABA routing number exactly as written, or null" },
      newAccountNumber: { type: ["string", "null"], description: "account number exactly as written, or null" },
      requestedBy: { type: ["string", "null"], description: "who signed or requested the change, or null" },
      contactAlsoChanged: { type: "boolean", description: "true only if a NEW phone number or contact is offered for verification" },
      newContactValue: { type: ["string", "null"], description: "the new phone number or contact as written, or null" },
      evidence: { type: "array", items: { type: "string" }, description: "short verbatim quotes supporting the decision" },
      confidence: { type: "number", description: "0 to 1" },
    },
    required: ["changed", "newRouting", "newAccountNumber", "requestedBy", "contactAlsoChanged", "newContactValue", "evidence", "confidence"],
  },
};

export async function extractWithClaude(args: {
  subject: string;
  body: string;
  attachmentText: string;
  pdfs: { data: string; name: string }[];
  currentRouting?: string;
  currentLast4?: string;
  vendorName?: string;
}): Promise<Extraction> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  const system = [
    "You are an accounts-payable analyst reviewing one inbound vendor email for a change in where the vendor should be paid.",
    args.vendorName ? `The sender claims to be ${args.vendorName}.` : "The sender domain does not match any vendor of record.",
    args.currentRouting ? `The vendor's current record shows routing ${args.currentRouting} and an account ending ${args.currentLast4}.` : "The vendor has no verified account on record.",
    "Report any instruction to pay a different account, including one that appears only in an attachment footer or remit-to block.",
    "Never guess digits: only report routing/account numbers that appear verbatim in the message or attachment.",
    "If unsure, set changed=false and explain in evidence.",
    "contactAlsoChanged=true only if the message offers a NEW phone number or new contact to call about banking.",
    "You have no ability to approve, verify, or pay anything. You only extract.",
    "Always respond by calling the extractInstructionChange tool exactly once; never answer in prose.",
  ].join(" ");

  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: `Subject: ${args.subject}\n\nBody:\n${args.body}` },
  ];
  if (args.attachmentText.trim()) content.push({ type: "text", text: `Attachment text layer:\n${args.attachmentText.slice(0, 20000)}` });
  for (const pdf of args.pdfs.slice(0, 3)) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } } as Anthropic.Messages.ContentBlockParam);
  }

  const res = await client.messages.create({
    model,
    max_tokens: 1024,
    system,
    tools: [TOOL as Anthropic.Messages.Tool],
    // Forced tool_choice (type "tool"/"any") returns 400 on Claude Sonnet 5.5 / Opus 5.5; use auto + strict + instruction.
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").slice(0, 300);
    return { changed: false, contactAlsoChanged: false, evidence: [`model returned no tool call: ${text || res.stop_reason}`], confidence: 0, mode: "claude" };
  }
  const inp = block.input as Record<string, unknown>;
  const digits = (s: unknown) => (typeof s === "string" ? s.replace(/\D/g, "") : undefined);
  let newRouting = digits(inp.newRouting);
  let newAccountNumber = digits(inp.newAccountNumber);
  // Defensive: the model said "changed" but left the digits out; recover them from the text with the rules extractor.
  if (inp.changed && (!newRouting || !newAccountNumber)) {
    const r = extractWithRules(`${args.subject}\n${args.body}\n${args.attachmentText}`, { currentRouting: args.currentRouting, currentLast4: args.currentLast4 });
    newRouting = newRouting ?? r.newRouting;
    newAccountNumber = newAccountNumber ?? r.newAccountNumber;
  }
  const changed = !!inp.changed && !!newRouting && newRouting.length === 9 && !!newAccountNumber && newAccountNumber.length >= 4;
  return {
    changed,
    newRouting: changed ? newRouting : undefined,
    newAccountNumber: changed ? newAccountNumber : undefined,
    requestedBy: typeof inp.requestedBy === "string" ? inp.requestedBy : undefined,
    contactAlsoChanged: !!inp.contactAlsoChanged,
    newContactValue: typeof inp.newContactValue === "string" ? inp.newContactValue : undefined,
    evidence: Array.isArray(inp.evidence) ? (inp.evidence as unknown[]).map(String) : [],
    confidence: typeof inp.confidence === "number" ? inp.confidence : 0,
    mode: "claude",
  };
}
