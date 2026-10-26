// ISO 20022 pain.001.001.03 (CustomerCreditTransferInitiation) builder.
// Pure: no Convex ctx, no I/O. Element order follows the XSD; comments cite
// the XSD type limits (Max35Text ids, Max140Text names, Max34Text account ids).

export const PAIN001_NAMESPACE = "urn:iso:std:iso:20022:tech:xsd:pain.001.001.03";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

export interface Pain001Account {
  accountNumber?: string;
  iban?: string;
}

export interface Pain001Agent {
  /** US ABA routing number (ClrSysMmbId with ClrSysId/Cd USABA). */
  routing?: string;
  /** Alternatively a BIC. */
  bic?: string;
}

export interface Pain001Debtor extends Pain001Account, Pain001Agent {
  name: string;
  /** Debtor account currency (DbtrAcct/Ccy). Default "USD". */
  currency?: string;
}

export interface Pain001Payment {
  endToEndId: string;
  instructionId?: string;
  amountCents: number;
  /** ISO 4217 code. Default "USD". */
  currency?: string;
  creditor: { name: string; addressLines?: string[]; country?: string };
  creditorAccount: Pain001Account;
  creditorAgent: Pain001Agent;
  /** Unstructured remittance (RmtInf/Ustrd). */
  remittance?: string;
  /** ExternalPurpose1Code (Purp/Cd), e.g. "SUPP". */
  purpose?: string;
}

export interface Pain001Input {
  msgId: string;
  createdAt: Date;
  initiatingParty: string;
  debtor: Pain001Debtor;
  requestedExecutionDate: Date;
  payments: Pain001Payment[];
  /** PmtInfId; defaults to msgId + "-1". */
  pmtInfId?: string;
}

export interface Pain001Result {
  xml: string;
  nbOfTxs: number;
  /** Sum of InstdAmt with 2 decimals, e.g. "5000.00". */
  ctrlSum: string;
}

// ---------------------------------------------------------------- helpers

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Truncate to an XSD MaxNText length. */
export function maxText(value: string, max: number): string {
  return value.slice(0, max);
}

/** Integer cents → "1234.56". */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** ISODate (YYYY-MM-DD, UTC). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISODateTime without milliseconds, e.g. 2026-10-25T09:30:00Z. */
export function isoDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

type XmlNode = { tag: string; attrs?: Record<string, string>; text?: string; children?: XmlNode[] };

const el = (tag: string, text: string, attrs?: Record<string, string>): XmlNode => ({ tag, text, attrs });
const wrap = (tag: string, children: (XmlNode | undefined)[], attrs?: Record<string, string>): XmlNode => ({
  tag,
  attrs,
  children: children.filter((c): c is XmlNode => c !== undefined),
});

function render(node: XmlNode, depth: number, out: string[]): void {
  const pad = " ".repeat(depth);
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${xmlEscape(v)}"`)
        .join("")
    : "";
  if (node.children && node.children.length > 0) {
    out.push(`${pad}<${node.tag}${attrs}>`);
    for (const c of node.children) render(c, depth + 1, out);
    out.push(`${pad}</${node.tag}>`);
  } else {
    out.push(`${pad}<${node.tag}${attrs}>${xmlEscape(node.text ?? "")}</${node.tag}>`);
  }
}

// ---------------------------------------------------------------- fragments

/** CashAccount16: Id/Othr/Id (Max34Text) or Id/IBAN. */
function accountId(acct: Pain001Account, label: string): XmlNode {
  if (acct.iban) return wrap("Id", [el("IBAN", maxText(acct.iban, 34))]);
  if (acct.accountNumber) return wrap("Id", [wrap("Othr", [el("Id", maxText(acct.accountNumber, 34))])]);
  throw new Error(`${label}: accountNumber or iban is required`);
}

/** BranchAndFinancialInstitutionIdentification4: ClrSysMmbId USABA or BIC. */
function agent(a: Pain001Agent, label: string): XmlNode {
  if (a.routing) {
    if (!/^\d{9}$/.test(a.routing)) throw new Error(`${label}: routing must be 9 digits`);
    return wrap("FinInstnId", [wrap("ClrSysMmbId", [wrap("ClrSysId", [el("Cd", "USABA")]), el("MmbId", a.routing)])]);
  }
  if (a.bic) return wrap("FinInstnId", [el("BIC", maxText(a.bic, 11))]);
  throw new Error(`${label}: routing or bic is required`);
}

function creditTransfer(p: Pain001Payment, index: number): XmlNode {
  const label = `payment ${index + 1}`;
  if (!p.endToEndId || p.endToEndId.trim() === "") throw new Error(`${label}: endToEndId is required`);
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
    throw new Error(`${label}: amountCents must be a positive integer (got ${p.amountCents})`);
  }
  const hasAddress = (p.creditor.addressLines?.length ?? 0) > 0 || !!p.creditor.country;
  return wrap("CdtTrfTxInf", [
    wrap("PmtId", [
      p.instructionId ? el("InstrId", maxText(p.instructionId, 35)) : undefined,
      el("EndToEndId", maxText(p.endToEndId, 35)),
    ]),
    wrap("Amt", [el("InstdAmt", formatAmount(p.amountCents), { Ccy: p.currency ?? "USD" })]),
    wrap("CdtrAgt", [agent(p.creditorAgent, `${label} creditorAgent`)]),
    wrap("Cdtr", [
      el("Nm", maxText(p.creditor.name, 140)),
      hasAddress
        ? wrap("PstlAdr", [
            p.creditor.country ? el("Ctry", maxText(p.creditor.country, 2)) : undefined,
            ...(p.creditor.addressLines ?? []).slice(0, 7).map((line) => el("AdrLine", maxText(line, 70))),
          ])
        : undefined,
    ]),
    wrap("CdtrAcct", [accountId(p.creditorAccount, `${label} creditorAccount`)]),
    p.purpose ? wrap("Purp", [el("Cd", maxText(p.purpose, 4))]) : undefined,
    p.remittance ? wrap("RmtInf", [el("Ustrd", maxText(p.remittance, 140))]) : undefined,
  ]);
}

// ---------------------------------------------------------------- builder

/** Build a pain.001.001.03 document with one PmtInf holding every payment. */
export function buildPain001(input: Pain001Input): Pain001Result {
  if (!input.msgId || input.msgId.trim() === "") throw new Error("msgId is required");
  if (input.payments.length === 0) throw new Error("at least one payment is required");

  const nbOfTxs = input.payments.length;
  const ctrlSum = formatAmount(input.payments.reduce((sum, p) => sum + p.amountCents, 0));
  const transfers = input.payments.map(creditTransfer);
  const pmtInfId = maxText(input.pmtInfId ?? `${input.msgId}-1`, 35);

  const doc = wrap(
    "Document",
    [
      wrap("CstmrCdtTrfInitn", [
        wrap("GrpHdr", [
          el("MsgId", maxText(input.msgId, 35)),
          el("CreDtTm", isoDateTime(input.createdAt)),
          el("NbOfTxs", String(nbOfTxs)),
          el("CtrlSum", ctrlSum),
          wrap("InitgPty", [el("Nm", maxText(input.initiatingParty, 140))]),
        ]),
        wrap("PmtInf", [
          el("PmtInfId", pmtInfId),
          el("PmtMtd", "TRF"),
          el("BtchBookg", "false"),
          el("NbOfTxs", String(nbOfTxs)),
          el("CtrlSum", ctrlSum),
          wrap("PmtTpInf", [wrap("SvcLvl", [el("Cd", "NURG")]), wrap("LclInstrm", [el("Cd", "CCD")])]),
          el("ReqdExctnDt", isoDate(input.requestedExecutionDate)),
          wrap("Dbtr", [el("Nm", maxText(input.debtor.name, 140))]),
          wrap("DbtrAcct", [accountId(input.debtor, "debtor"), el("Ccy", input.debtor.currency ?? "USD")]),
          wrap("DbtrAgt", [agent(input.debtor, "debtor")]),
          el("ChrgBr", "SLEV"),
          ...transfers,
        ]),
      ]),
    ],
    { xmlns: PAIN001_NAMESPACE, "xmlns:xsi": XSI_NAMESPACE },
  );

  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  render(doc, 0, out);
  return { xml: out.join("\n") + "\n", nbOfTxs, ctrlSum };
}

// ---------------------------------------------------------------- masking

function maskId(id: string): string {
  return `****${id.slice(-4)}`;
}

/** Mask Othr/Id and IBAN values inside DbtrAcct and CdtrAcct to "****" + last 4. */
export function maskPain001(xml: string): string {
  return xml.replace(/<(DbtrAcct|CdtrAcct)>([\s\S]*?)<\/\1>/g, (_m, tag: string, body: string) => {
    const masked = body
      .replace(/(<Othr>\s*<Id>)([^<]*)(<\/Id>)/g, (_x, open: string, id: string, close: string) => `${open}${maskId(id)}${close}`)
      .replace(/(<IBAN>)([^<]*)(<\/IBAN>)/g, (_x, open: string, id: string, close: string) => `${open}${maskId(id)}${close}`);
    return `<${tag}>${masked}</${tag}>`;
  });
}
