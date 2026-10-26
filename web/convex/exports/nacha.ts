// Nacha ACH file builder (pure; no Convex ctx, no I/O).
// Field positions cite the Nacha ACH Developer Guide: every record is exactly
// 94 fixed-width ASCII chars, order 1 → 5 → 6 [→ 7] → 8 → 9 → "9" padding.
// Alphanumeric fields are left-justified space-filled; numeric fields are
// right-justified zero-filled; amounts are integer cents.

export const RECORD_LENGTH = 94;
export const BLOCKING_FACTOR = 10;
export const MICRO_ENTRY_DESCRIPTION = "ACCTVERIFY";
const MAX_ENTRIES = 9_999_999; // 7-digit trace sequence

export type NachaTransactionCode = "22" | "23" | "32" | "33";
export type NachaSecCode = "CCD" | "PPD" | "CTX";

export interface NachaOriginator {
  /** 9-digit RTN of the receiving bank (File Header pos 4-13, with leading blank). */
  immediateDestination: string;
  /** 10 chars, usually "1"+EIN or a blank+RTN (File Header pos 14-23). */
  immediateOrigin: string;
  destinationName: string;
  originName: string;
  /** <=16 chars (Batch Header pos 5-20). */
  companyName: string;
  /** 10 chars (Batch Header pos 41-50, Batch Control pos 45-54). */
  companyId: string;
  /** 9-digit ODFI routing; first 8 digits form the ODFI id and trace prefix. */
  odfiRouting: string;
}

export interface NachaEntry {
  /** 9 digits including the check digit. */
  routing: string;
  /** 1..17 digits. */
  accountNumber: string;
  amountCents: number;
  /** <=22 chars (Entry Detail pos 55-76). */
  receiverName: string;
  /** <=15 chars, e.g. vendor id (Entry Detail pos 40-54). */
  receiverId: string;
  /** <=80 chars, e.g. invoice number; emits a type-7 Addenda record. */
  addenda?: string;
}

export interface NachaBatchOptions {
  secCode: NachaSecCode;
  /** <=10 chars (Batch Header pos 54-63), e.g. "VENDOR PAY" or "ACCTVERIFY". */
  entryDescription: string;
  effectiveDate: Date;
  /** <=6 chars (Batch Header pos 64-69); defaults to effectiveDate as YYMMDD. */
  descriptiveDate?: string;
  /** Default "22" (checking credit). */
  transactionCode?: NachaTransactionCode;
  batchNumber?: number;
  /** A-Z or 0-9, unique per day (File Header pos 34). Default "A". */
  fileIdModifier?: string;
  /** File creation timestamp (File Header pos 24-33). Default: now. */
  createdAt?: Date;
}

export interface NachaFileResult {
  text: string;
  /** Count of real records (types 1,5,6,7,8,9), excluding "9" padding lines. */
  records: number;
  blockCount: number;
  entryHash: string;
  totalCreditCents: number;
  traceNumbers: string[];
}

// ---------------------------------------------------------------- formatting

/** Alphanumeric: uppercase, strip line breaks, truncate, left-justify, space-fill. */
export function alpha(value: string, len: number): string {
  const clean = value.replace(/[\r\n]/g, " ").toUpperCase();
  return clean.slice(0, len).padEnd(len, " ");
}

/** Numeric: right-justify, zero-fill; over-long values keep the rightmost digits. */
export function num(value: number | string, len: number): string {
  const digits = String(value).replace(/\D/g, "");
  return digits.slice(-len).padStart(len, "0");
}

/** Date as YYMMDD (UTC components). */
export function yymmdd(d: Date): string {
  const yy = String(d.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/** Time as HHMM (UTC components). */
export function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- validation

/** ABA 3-7-1 check: (3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9)) mod 10 == 0. */
export function abaCheckDigitValid(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function assertRouting(routing: string, label: string): void {
  if (!/^\d{9}$/.test(routing)) {
    throw new Error(`${label}: routing number must be exactly 9 digits (got "${routing}")`);
  }
  if (!abaCheckDigitValid(routing)) {
    throw new Error(`${label}: routing number ${routing} fails the ABA check-digit test`);
  }
}

function assertEntry(entry: NachaEntry, index: number): void {
  const label = `entry ${index + 1}`;
  assertRouting(entry.routing, label);
  if (!/^\d{1,17}$/.test(entry.accountNumber)) {
    throw new Error(`${label}: account number must be 1..17 digits`);
  }
  if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
    throw new Error(`${label}: amount must be a positive integer number of cents (got ${entry.amountCents})`);
  }
  if (entry.addenda !== undefined && entry.addenda.length > 80) {
    throw new Error(`${label}: addenda must be at most 80 characters`);
  }
}

function assertOriginator(o: NachaOriginator): void {
  assertRouting(o.immediateDestination, "originator.immediateDestination");
  assertRouting(o.odfiRouting, "originator.odfiRouting");
  if (o.immediateOrigin.length < 9 || o.immediateOrigin.length > 10) {
    throw new Error("originator.immediateOrigin must be 9 or 10 characters");
  }
}

// ---------------------------------------------------------------- records

/** Entry hash: sum of 8-digit Receiving DFI ids, rightmost 10 digits kept. */
export function entryHashOf(routings: string[]): string {
  let sum = 0;
  for (const r of routings) sum += Number(r.slice(0, 8));
  return num(sum, 10);
}

function fileHeader(o: NachaOriginator, createdAt: Date, modifier: string): string {
  const origin = o.immediateOrigin.length === 9 ? ` ${o.immediateOrigin}` : o.immediateOrigin;
  return (
    "1" + // 1    Record Type
    "01" + // 2-3  Priority Code
    ` ${o.immediateDestination}` + // 4-13 Immediate Destination (blank + RTN)
    origin.slice(0, 10) + // 14-23 Immediate Origin
    yymmdd(createdAt) + // 24-29 File Creation Date
    hhmm(createdAt) + // 30-33 File Creation Time
    alpha(modifier, 1) + // 34   File ID Modifier
    "094" + // 35-37 Record Size
    "10" + // 38-39 Blocking Factor
    "1" + // 40   Format Code
    alpha(o.destinationName, 23) + // 41-63 Immediate Destination Name
    alpha(o.originName, 23) + // 64-86 Immediate Origin Name
    " ".repeat(8) // 87-94 Reference Code
  );
}

function batchHeader(o: NachaOriginator, opts: NachaBatchOptions, odfiId: string, batchNumber: number): string {
  return (
    "5" + // 1    Record Type
    "220" + // 2-4  Service Class Code (credits only)
    alpha(o.companyName, 16) + // 5-20 Company Name
    " ".repeat(20) + // 21-40 Company Discretionary Data
    alpha(o.companyId, 10) + // 41-50 Company Identification
    alpha(opts.secCode, 3) + // 51-53 SEC Code
    alpha(opts.entryDescription, 10) + // 54-63 Company Entry Description
    alpha(opts.descriptiveDate ?? yymmdd(opts.effectiveDate), 6) + // 64-69 Descriptive Date
    yymmdd(opts.effectiveDate) + // 70-75 Effective Entry Date
    "   " + // 76-78 Settlement Date (filled by Operator)
    "1" + // 79   Originator Status Code
    odfiId + // 80-87 Originating DFI ID
    num(batchNumber, 7) // 88-94 Batch Number
  );
}

function entryDetail(e: NachaEntry, txCode: string, trace: string, secCode: NachaSecCode): string {
  const common =
    "6" + // 1    Record Type
    txCode + // 2-3  Transaction Code
    e.routing.slice(0, 8) + // 4-11 Receiving DFI ID
    e.routing.slice(8, 9) + // 12   Check Digit
    alpha(e.accountNumber, 17) + // 13-29 DFI Account Number
    num(e.amountCents, 10) + // 30-39 Amount (cents)
    alpha(e.receiverId, 15); // 40-54 Identification Number
  const addendaIndicator = e.addenda ? "1" : "0";
  if (secCode === "CTX") {
    return (
      common +
      num(e.addenda ? 1 : 0, 4) + // 55-58 Number of Addenda Records
      alpha(e.receiverName, 16) + // 59-74 Receiving Company Name/ID
      "  " + // 75-76 Reserved
      "  " + // 77-78 Discretionary Data
      addendaIndicator + // 79   Addenda Record Indicator
      trace // 80-94 Trace Number
    );
  }
  return (
    common +
    alpha(e.receiverName, 22) + // 55-76 Receiving Individual/Company Name
    "  " + // 77-78 Discretionary Data
    addendaIndicator + // 79   Addenda Record Indicator
    trace // 80-94 Trace Number
  );
}

function addendaRecord(info: string, trace: string): string {
  return (
    "7" + // 1    Record Type
    "05" + // 2-3  Addenda Type Code
    alpha(info, 80) + // 4-83 Payment Related Information
    "0001" + // 84-87 Addenda Sequence Number
    trace.slice(-7) // 88-94 Entry Detail Sequence Number
  );
}

function batchControl(
  o: NachaOriginator,
  count: number,
  hash: string,
  credit: number,
  odfiId: string,
  batchNumber: number,
): string {
  return (
    "8" + // 1    Record Type
    "220" + // 2-4  Service Class Code
    num(count, 6) + // 5-10 Entry/Addenda Count
    hash + // 11-20 Entry Hash
    num(0, 12) + // 21-32 Total Debit Amount
    num(credit, 12) + // 33-44 Total Credit Amount
    alpha(o.companyId, 10) + // 45-54 Company Identification
    " ".repeat(19) + // 55-73 Message Authentication Code
    " ".repeat(6) + // 74-79 Reserved
    odfiId + // 80-87 Originating DFI ID
    num(batchNumber, 7) // 88-94 Batch Number
  );
}

function fileControl(blockCount: number, count: number, hash: string, credit: number): string {
  return (
    "9" + // 1    Record Type
    num(1, 6) + // 2-7  Batch Count
    num(blockCount, 6) + // 8-13 Block Count
    num(count, 8) + // 14-21 Entry/Addenda Count
    hash + // 22-31 Entry Hash
    num(0, 12) + // 32-43 Total Debit
    num(credit, 12) + // 44-55 Total Credit
    " ".repeat(39) // 56-94 Reserved
  );
}

// ---------------------------------------------------------------- builders

/** Build a single-batch, credits-only (SCC 220) Nacha file. Lines end with "\n". */
export function buildNachaFile(
  originator: NachaOriginator,
  entries: NachaEntry[],
  options: NachaBatchOptions,
): NachaFileResult {
  assertOriginator(originator);
  if (entries.length === 0) throw new Error("at least one entry is required");
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`too many entries: ${entries.length} exceeds the 7-digit trace limit of ${MAX_ENTRIES}`);
  }
  entries.forEach(assertEntry);

  const txCode = options.transactionCode ?? "22";
  const batchNumber = options.batchNumber ?? 1;
  const createdAt = options.createdAt ?? new Date();
  const odfiId = originator.odfiRouting.slice(0, 8);

  const lines: string[] = [];
  lines.push(fileHeader(originator, createdAt, options.fileIdModifier ?? "A"));
  lines.push(batchHeader(originator, options, odfiId, batchNumber));

  const traceNumbers: string[] = [];
  let totalCreditCents = 0;
  let entryAddendaCount = 0;
  entries.forEach((e, i) => {
    const trace = odfiId + num(i + 1, 7);
    traceNumbers.push(trace);
    lines.push(entryDetail(e, txCode, trace, options.secCode));
    entryAddendaCount += 1;
    if (e.addenda) {
      lines.push(addendaRecord(e.addenda, trace));
      entryAddendaCount += 1;
    }
    totalCreditCents += e.amountCents;
  });

  const entryHash = entryHashOf(entries.map((e) => e.routing));
  lines.push(batchControl(originator, entryAddendaCount, entryHash, totalCreditCents, odfiId, batchNumber));

  const records = lines.length + 1; // + file control
  const blockCount = Math.ceil(records / BLOCKING_FACTOR);
  lines.push(fileControl(blockCount, entryAddendaCount, entryHash, totalCreditCents));
  while (lines.length < blockCount * BLOCKING_FACTOR) lines.push("9".repeat(RECORD_LENGTH));

  for (const line of lines) {
    if (line.length !== RECORD_LENGTH) {
      throw new Error(`internal: record is ${line.length} chars, expected ${RECORD_LENGTH}: ${line}`);
    }
  }
  return { text: lines.join("\n") + "\n", records, blockCount, entryHash, totalCreditCents, traceNumbers };
}

export type MicroEntryOptions = Omit<NachaBatchOptions, "entryDescription"> & { entryDescription?: string };

/** Nacha Micro-Entry file: credits only, each < $1.00, Company Entry Description "ACCTVERIFY". */
export function buildMicroEntryFile(
  originator: NachaOriginator,
  entries: NachaEntry[],
  options: MicroEntryOptions,
): NachaFileResult {
  const txCode = options.transactionCode ?? "22";
  if (txCode !== "22" && txCode !== "32") {
    throw new Error(`micro-entries must be credits (transaction code 22 or 32), got ${txCode}`);
  }
  entries.forEach((e, i) => {
    if (!Number.isInteger(e.amountCents) || e.amountCents <= 0 || e.amountCents >= 100) {
      throw new Error(`entry ${i + 1}: micro-entry amount must be between 1 and 99 cents (got ${e.amountCents})`);
    }
  });
  return buildNachaFile(originator, entries, { ...options, transactionCode: txCode, entryDescription: MICRO_ENTRY_DESCRIPTION });
}

// ---------------------------------------------------------------- masking

/** Mask an account number to "*" + last 4 (fewer than 4 chars stay unmasked). */
export function maskAccount(account: string): string {
  const keep = account.slice(-4);
  return "*".repeat(Math.max(0, account.length - 4)) + keep;
}

/** Mask the DFI Account Number field (pos 13-29) of every Entry Detail record. */
export function maskNachaFile(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (line.length !== RECORD_LENGTH || line[0] !== "6") return line;
      const account = line.slice(12, 29).trimEnd();
      return line.slice(0, 12) + maskAccount(account).padEnd(17, " ") + line.slice(29);
    })
    .join("\n");
}

// ---------------------------------------------------------------- parsing

export interface ParsedFileHeader {
  recordType: string;
  priorityCode: string;
  immediateDestination: string;
  immediateOrigin: string;
  fileCreationDate: string;
  fileCreationTime: string;
  fileIdModifier: string;
  recordSize: string;
  blockingFactor: string;
  formatCode: string;
  destinationName: string;
  originName: string;
  referenceCode: string;
}

export interface ParsedBatchHeader {
  serviceClassCode: string;
  companyName: string;
  companyDiscretionaryData: string;
  companyId: string;
  secCode: string;
  entryDescription: string;
  descriptiveDate: string;
  effectiveDate: string;
  settlementDate: string;
  originatorStatusCode: string;
  odfiId: string;
  batchNumber: number;
}

export interface ParsedEntry {
  transactionCode: string;
  /** 8-digit DFI id + check digit. */
  routing: string;
  /** Trimmed account field; may contain "*" when the file was masked. */
  account: string;
  accountMasked: boolean;
  amountCents: number;
  receiverId: string;
  receiverName: string;
  addendaIndicator: string;
  traceNumber: string;
  addenda?: { typeCode: string; info: string; sequence: string; entryDetailSequence: string };
}

export interface ParsedBatchControl {
  serviceClassCode: string;
  entryAddendaCount: number;
  entryHash: string;
  totalDebitCents: number;
  totalCreditCents: number;
  companyId: string;
  odfiId: string;
  batchNumber: number;
}

export interface ParsedFileControl {
  batchCount: number;
  blockCount: number;
  entryAddendaCount: number;
  entryHash: string;
  totalDebitCents: number;
  totalCreditCents: number;
}

export interface ParsedNachaFile {
  header: ParsedFileHeader;
  batches: { header: ParsedBatchHeader; entries: ParsedEntry[]; control: ParsedBatchControl }[];
  control: ParsedFileControl;
  paddingLines: number;
}

/** 1-based inclusive positions, as written in the Nacha spec. */
function field(line: string, from: number, to: number): string {
  return line.slice(from - 1, to);
}

/** Small reader used for round-trip tests and previews; not a full validator. */
export function parseNachaFile(text: string): ParsedNachaFile {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  lines.forEach((l, i) => {
    if (l.length !== RECORD_LENGTH) throw new Error(`line ${i + 1} is ${l.length} chars, expected ${RECORD_LENGTH}`);
  });
  let header: ParsedFileHeader | undefined;
  let control: ParsedFileControl | undefined;
  const batches: ParsedNachaFile["batches"] = [];
  let current: ParsedNachaFile["batches"][number] | undefined;
  let paddingLines = 0;

  for (const line of lines) {
    switch (line[0]) {
      case "1":
        header = {
          recordType: field(line, 1, 1),
          priorityCode: field(line, 2, 3),
          immediateDestination: field(line, 4, 13).trim(),
          immediateOrigin: field(line, 14, 23).trim(),
          fileCreationDate: field(line, 24, 29),
          fileCreationTime: field(line, 30, 33),
          fileIdModifier: field(line, 34, 34),
          recordSize: field(line, 35, 37),
          blockingFactor: field(line, 38, 39),
          formatCode: field(line, 40, 40),
          destinationName: field(line, 41, 63).trim(),
          originName: field(line, 64, 86).trim(),
          referenceCode: field(line, 87, 94).trim(),
        };
        break;
      case "5":
        current = {
          header: {
            serviceClassCode: field(line, 2, 4),
            companyName: field(line, 5, 20).trim(),
            companyDiscretionaryData: field(line, 21, 40).trim(),
            companyId: field(line, 41, 50).trim(),
            secCode: field(line, 51, 53),
            entryDescription: field(line, 54, 63).trim(),
            descriptiveDate: field(line, 64, 69).trim(),
            effectiveDate: field(line, 70, 75),
            settlementDate: field(line, 76, 78).trim(),
            originatorStatusCode: field(line, 79, 79),
            odfiId: field(line, 80, 87),
            batchNumber: Number(field(line, 88, 94)),
          },
          entries: [],
          control: undefined as unknown as ParsedBatchControl,
        };
        batches.push(current);
        break;
      case "6": {
        if (!current) throw new Error("entry detail record before batch header");
        const account = field(line, 13, 29).trim();
        const isCtx = current.header.secCode === "CTX";
        current.entries.push({
          transactionCode: field(line, 2, 3),
          routing: field(line, 4, 12),
          account,
          accountMasked: account.includes("*"),
          amountCents: Number(field(line, 30, 39)),
          receiverId: field(line, 40, 54).trim(),
          receiverName: (isCtx ? field(line, 59, 74) : field(line, 55, 76)).trim(),
          addendaIndicator: field(line, 79, 79),
          traceNumber: field(line, 80, 94),
        });
        break;
      }
      case "7": {
        const entry = current?.entries[current.entries.length - 1];
        if (!entry) throw new Error("addenda record without a preceding entry detail");
        entry.addenda = {
          typeCode: field(line, 2, 3),
          info: field(line, 4, 83).trimEnd(),
          sequence: field(line, 84, 87),
          entryDetailSequence: field(line, 88, 94),
        };
        break;
      }
      case "8":
        if (!current) throw new Error("batch control record before batch header");
        current.control = {
          serviceClassCode: field(line, 2, 4),
          entryAddendaCount: Number(field(line, 5, 10)),
          entryHash: field(line, 11, 20),
          totalDebitCents: Number(field(line, 21, 32)),
          totalCreditCents: Number(field(line, 33, 44)),
          companyId: field(line, 45, 54).trim(),
          odfiId: field(line, 80, 87),
          batchNumber: Number(field(line, 88, 94)),
        };
        current = undefined;
        break;
      case "9":
        if (line === "9".repeat(RECORD_LENGTH)) {
          paddingLines += 1;
        } else {
          control = {
            batchCount: Number(field(line, 2, 7)),
            blockCount: Number(field(line, 8, 13)),
            entryAddendaCount: Number(field(line, 14, 21)),
            entryHash: field(line, 22, 31),
            totalDebitCents: Number(field(line, 32, 43)),
            totalCreditCents: Number(field(line, 44, 55)),
          };
        }
        break;
      default:
        throw new Error(`unknown record type "${line[0]}"`);
    }
  }
  if (!header) throw new Error("missing file header record");
  if (!control) throw new Error("missing file control record");
  return { header, batches, control, paddingLines };
}
