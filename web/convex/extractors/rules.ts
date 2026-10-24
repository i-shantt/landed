// Rule-based extractor. No network. Finds a 9-digit ABA routing number (checksum
// validated) and a 5-17 digit account number near banking keywords, plus change
// phrases. Also flags a new phone number offered in the same message.

export type Extraction = {
  changed: boolean;
  newRouting?: string;
  newAccountNumber?: string;
  requestedBy?: string;
  contactAlsoChanged: boolean;
  newContactValue?: string;
  evidence: string[];
  confidence: number;
  mode: "rules" | "claude" | "off";
  receiptClaimCents?: number;
};

export function abaChecksumOk(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

const KEYWORDS = /\b(account|acct|routing|aba|bank|remit|remittance|wire|ach|beneficiary|iban|swift)\b/i;
const CHANGE_PHRASES = [
  /changed\s+banks?/i, /new\s+bank(ing)?/i, /updated?\s+(our\s+)?bank(ing)?/i, /switch(ed|ing)?\s+(our\s+)?bank/i,
  /new\s+(remit|remittance|payment)\s+(details|instructions|info)/i, /updated?\s+(remit|remittance|payment)\s+(details|instructions|info)/i,
  /please\s+(update|use)\s+(the\s+)?(new\s+)?(account|banking|remittance)/i, /going\s+forward.*(account|bank)/i,
  /banking\s+(details|information)\s+(have\s+)?(been\s+)?(changed|updated)/i, /new\s+account\s+(number|details)/i,
  /remit\s+(all\s+)?(future\s+)?payments?\s+to/i, /wire\s+instructions/i,
];
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const CONTACT_CHANGE = /(new|updated?|direct|reach me at|call me at|my new|changed).{0,40}(phone|number|cell|mobile|line)|(phone|number|cell|mobile).{0,30}(changed|new|updated)/i;

export function extractWithRules(text: string, opts: { currentRouting?: string; currentLast4?: string } = {}): Extraction {
  const evidence: string[] = [];
  const t = text.replace(/ /g, " ");

  // candidate routing numbers: 9 digits with valid checksum, near a keyword
  const routingCands: string[] = [];
  for (const m of t.matchAll(/\b\d{9}\b/g)) {
    const r = m[0];
    if (!abaChecksumOk(r)) continue;
    const ctx = t.slice(Math.max(0, m.index! - 200), m.index! + 209);
    if (KEYWORDS.test(ctx)) routingCands.push(r);
  }
  // candidate account numbers: 5-17 digits near keyword, not a routing number, not a phone
  const acctCands: string[] = [];
  for (const m of t.matchAll(/\b\d[\d -]{3,20}\d\b/g)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length < 5 || digits.length > 17) continue;
    if (routingCands.includes(digits)) continue;
    if (digits.length === 10 && /^\d{10}$/.test(digits) && /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(m[0])) continue; // formatted phone
    const ctx = t.slice(Math.max(0, m.index! - 200), m.index! + m[0].length + 200);
    if (!/\b(account|acct|a\/c|acc(?:ount)?\s*(?:no|#|number)|beneficiary)\b/i.test(ctx)) continue;
    acctCands.push(digits);
  }
  const changePhrase = CHANGE_PHRASES.find((re) => re.test(t));
  if (changePhrase) evidence.push(`change phrase: ${t.match(changePhrase)?.[0]}`);

  const newRouting = routingCands.find((r) => r !== opts.currentRouting) ?? routingCands[0];
  const newAccountNumber = acctCands.find((a) => !opts.currentLast4 || !a.endsWith(opts.currentLast4)) ?? acctCands[0];
  if (newRouting) evidence.push(`routing candidate ${newRouting}`);
  if (newAccountNumber) evidence.push(`account candidate ending ${newAccountNumber.slice(-4)}`);

  const sameAsCurrent = !!(newRouting && newAccountNumber && opts.currentRouting === newRouting && opts.currentLast4 && newAccountNumber.endsWith(opts.currentLast4));
  const changed = !!(newRouting && newAccountNumber && !sameAsCurrent);

  // contact change
  let contactAlsoChanged = false;
  let newContactValue: string | undefined;
  if (CONTACT_CHANGE.test(t)) {
    const phones = Array.from(t.matchAll(PHONE)).map((m) => m[0]).filter((p) => p.replace(/\D/g, "").length >= 10);
    if (phones.length) {
      contactAlsoChanged = true;
      newContactValue = "+1" + phones[0].replace(/\D/g, "").slice(-10);
      evidence.push(`new contact offered: ${newContactValue}`);
    }
  }

  // receipt claim ("we received $0.37")
  let receiptClaimCents: number | undefined;
  const rc = t.match(/(received|got|see|showing|arrived)[^.\n]{0,60}\$\s?0?\.(\d{2})\b/i) ?? t.match(/\$\s?0?\.(\d{2})\b[^.\n]{0,60}(received|arrived|deposit|landed|showed up)/i);
  if (rc) {
    const centsMatch = rc[0].match(/\$\s?0?\.(\d{2})/);
    if (centsMatch) receiptClaimCents = Number(centsMatch[1]);
  }

  let confidence = 0;
  if (changed) confidence = changePhrase ? 0.9 : 0.6;
  return { changed, newRouting: changed ? newRouting : undefined, newAccountNumber: changed ? newAccountNumber : undefined, contactAlsoChanged, newContactValue, evidence, confidence, mode: "rules", receiptClaimCents };
}
