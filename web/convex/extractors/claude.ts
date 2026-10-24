"use node";
// Claude extractor: one tool-forced messages.create call. Only the current
// vendor's routing and last four are ever sent. Never any other vendor's data.
import Anthropic from "@anthropic-ai/sdk";
import type { Extraction } from "./rules";

export const TOOL = {
  name: "extractInstructionChange",
  description: "Extract any change to where this vendor should be paid.",
  input_schema: {
    type: "object" as const,
    properties: {
      changed: { type: "boolean" },
      newRouting: { type: "string" },
      newAccountNumber: { type: "string" },
      requestedBy: { type: "string" },
      contactAlsoChanged: { type: "boolean" },
      newContactValue: { type: "string" },
      evidence: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
    required: ["changed", "contactAlsoChanged", "evidence", "confidence"],
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
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("no tool_use block");
  const inp = block.input as Record<string, unknown>;
  const digits = (s: unknown) => (typeof s === "string" ? s.replace(/\D/g, "") : undefined);
  const newRouting = digits(inp.newRouting);
  const newAccountNumber = digits(inp.newAccountNumber);
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
