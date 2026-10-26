import { describe, it, expect } from "vitest";
import {
  abaCheckDigitValid,
  buildMicroEntryFile,
  buildNachaFile,
  entryHashOf,
  maskNachaFile,
  parseNachaFile,
  MICRO_ENTRY_DESCRIPTION,
  type NachaBatchOptions,
  type NachaEntry,
  type NachaOriginator,
} from "../convex/exports/nacha";
import { buildPain001, maskPain001, PAIN001_NAMESPACE, type Pain001Input } from "../convex/exports/pain001";

// 1-based inclusive positions, matching the Nacha spec tables.
const pos = (line: string, from: number, to: number) => line.slice(from - 1, to);
const lines = (text: string) => text.split("\n").filter((l) => l.length > 0);

const originator: NachaOriginator = {
  immediateDestination: "021000021",
  immediateOrigin: "1123456789",
  destinationName: "JPMorgan Chase",
  originName: "Landed Inc",
  companyName: "Landed Inc",
  companyId: "1123456789",
  odfiRouting: "044000024",
};

const entries: NachaEntry[] = [
  { routing: "021000021", accountNumber: "987654321", amountCents: 500000, receiverName: "ABC Manufacturing Inc", receiverId: "VEND-001" },
  { routing: "061000104", accountNumber: "12345678901234567", amountCents: 12345, receiverName: "Beta Supply Co", receiverId: "VEND-002", addenda: "INV-2026-0558" },
  { routing: "044000024", accountNumber: "55", amountCents: 1, receiverName: "Gamma Logistics LLC", receiverId: "VEND-003" },
];

const options: NachaBatchOptions = {
  secCode: "CCD",
  entryDescription: "VENDOR PAY",
  effectiveDate: new Date(Date.UTC(2026, 9, 27)),
  createdAt: new Date(Date.UTC(2026, 9, 25, 9, 30)),
};

describe("nacha: record geometry", () => {
  const file = buildNachaFile(originator, entries, options);
  const recs = lines(file.text);

  it("every record is exactly 94 characters", () => {
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) expect(r).toHaveLength(94);
  });

  it("total lines are a multiple of 10 and padding lines are all 9s", () => {
    expect(recs.length % 10).toBe(0);
    // 1 header + 1 batch header + 3 entries + 1 addenda + 1 batch control + 1 file control = 8 real records
    expect(file.records).toBe(8);
    const padding = recs.slice(file.records);
    expect(padding).toHaveLength(2);
    for (const p of padding) expect(p).toBe("9".repeat(94));
  });

  it("block count is ceil(records / 10)", () => {
    expect(file.blockCount).toBe(1);
    expect(recs).toHaveLength(file.blockCount * 10);
    const many = buildNachaFile(originator, Array.from({ length: 20 }, () => entries[0]), options);
    expect(many.records).toBe(24);
    expect(many.blockCount).toBe(3);
    expect(lines(many.text)).toHaveLength(30);
    expect(pos(lines(many.text)[23], 8, 13)).toBe("000003");
  });
});

describe("nacha: header records", () => {
  const file = buildNachaFile(originator, entries, options);
  const [fileHeader, batchHeader] = lines(file.text);

  it("file header fields sit at the spec positions", () => {
    expect(pos(fileHeader, 1, 1)).toBe("1");
    expect(pos(fileHeader, 2, 3)).toBe("01");
    expect(pos(fileHeader, 4, 13)).toBe(" 021000021");
    expect(pos(fileHeader, 14, 23)).toBe("1123456789");
    expect(pos(fileHeader, 24, 29)).toBe("261025");
    expect(pos(fileHeader, 30, 33)).toBe("0930");
    expect(pos(fileHeader, 34, 34)).toBe("A");
    expect(pos(fileHeader, 35, 37)).toBe("094");
    expect(pos(fileHeader, 38, 39)).toBe("10");
    expect(pos(fileHeader, 40, 40)).toBe("1");
    expect(pos(fileHeader, 41, 63)).toBe("JPMORGAN CHASE         ");
    expect(pos(fileHeader, 64, 86)).toBe("LANDED INC             ");
    expect(pos(fileHeader, 87, 94)).toBe("        ");
  });

  it("a 9-digit immediate origin gets a leading blank and the file id modifier is honored", () => {
    const f = buildNachaFile({ ...originator, immediateOrigin: "044000024" }, entries, { ...options, fileIdModifier: "b" });
    const h = lines(f.text)[0];
    expect(pos(h, 14, 23)).toBe(" 044000024");
    expect(pos(h, 34, 34)).toBe("B");
  });

  it("batch header carries SCC 220, SEC code, entry description, effective date and ODFI id", () => {
    expect(pos(batchHeader, 1, 1)).toBe("5");
    expect(pos(batchHeader, 2, 4)).toBe("220");
    expect(pos(batchHeader, 5, 20)).toBe("LANDED INC      ");
    expect(pos(batchHeader, 21, 40)).toBe(" ".repeat(20));
    expect(pos(batchHeader, 41, 50)).toBe("1123456789");
    expect(pos(batchHeader, 51, 53)).toBe("CCD");
    expect(pos(batchHeader, 54, 63)).toBe("VENDOR PAY");
    expect(pos(batchHeader, 64, 69)).toBe("261027"); // descriptive date defaults to effective date
    expect(pos(batchHeader, 70, 75)).toBe("261027");
    expect(pos(batchHeader, 76, 78)).toBe("   ");
    expect(pos(batchHeader, 79, 79)).toBe("1");
    expect(pos(batchHeader, 80, 87)).toBe("04400002");
    expect(pos(batchHeader, 88, 94)).toBe("0000001");
  });

  it("over-long names are truncated and uppercased, descriptive date and batch number are honored", () => {
    const f = buildNachaFile(
      { ...originator, companyName: "a very long company name indeed" },
      entries,
      { ...options, descriptiveDate: "OCT 27", batchNumber: 42 },
    );
    const h = lines(f.text)[1];
    expect(pos(h, 5, 20)).toBe("A VERY LONG COMP");
    expect(pos(h, 64, 69)).toBe("OCT 27");
    expect(pos(h, 88, 94)).toBe("0000042");
    expect(pos(lines(f.text)[6], 88, 94)).toBe("0000042"); // batch control echoes it
  });
});

describe("nacha: entry detail and addenda", () => {
  const file = buildNachaFile(originator, entries, options);
  const recs = lines(file.text);
  const details = recs.filter((r) => r[0] === "6");

  it("entry detail fields sit at the spec positions", () => {
    const d = details[0];
    expect(pos(d, 2, 3)).toBe("22");
    expect(pos(d, 4, 11)).toBe("02100002");
    expect(pos(d, 12, 12)).toBe("1");
    expect(pos(d, 4, 12)).toBe("021000021");
    expect(pos(d, 13, 29)).toBe("987654321        ");
    expect(pos(d, 30, 39)).toBe("0000500000");
    expect(pos(d, 40, 54)).toBe("VEND-001       ");
    expect(pos(d, 55, 76)).toBe("ABC MANUFACTURING INC ");
    expect(pos(d, 77, 78)).toBe("  ");
    expect(pos(d, 79, 79)).toBe("0");
    expect(pos(d, 80, 94)).toBe("044000020000001");
    // 17-digit account fills the whole field; $0.01 is zero-filled
    expect(pos(details[1], 13, 29)).toBe("12345678901234567");
    expect(pos(details[2], 30, 39)).toBe("0000000001");
  });

  it("trace numbers are ODFI id + ascending 7-digit sequence", () => {
    expect(file.traceNumbers).toEqual(["044000020000001", "044000020000002", "044000020000003"]);
    expect(details.map((d) => pos(d, 80, 94))).toEqual(file.traceNumbers);
  });

  it("transaction code option is applied (32 = savings credit)", () => {
    const f = buildNachaFile(originator, entries, { ...options, transactionCode: "32" });
    for (const d of lines(f.text).filter((r) => r[0] === "6")) expect(pos(d, 2, 3)).toBe("32");
  });

  it("addenda record is wired to its entry", () => {
    expect(pos(details[1], 79, 79)).toBe("1");
    const addenda = recs[recs.indexOf(details[1]) + 1];
    expect(pos(addenda, 1, 1)).toBe("7");
    expect(pos(addenda, 2, 3)).toBe("05");
    expect(pos(addenda, 4, 83)).toBe("INV-2026-0558".padEnd(80, " "));
    expect(pos(addenda, 84, 87)).toBe("0001");
    expect(pos(addenda, 88, 94)).toBe("0000002");
    expect(recs.filter((r) => r[0] === "7")).toHaveLength(1);
  });

  it("CTX layout uses the 4-digit addenda count and 16-char receiving company name", () => {
    const f = buildNachaFile(originator, entries, { ...options, secCode: "CTX" });
    const d = lines(f.text).filter((r) => r[0] === "6")[1];
    expect(pos(d, 55, 58)).toBe("0001");
    expect(pos(d, 59, 74)).toBe("BETA SUPPLY CO  ");
    expect(pos(d, 75, 78)).toBe("    ");
    expect(pos(d, 79, 79)).toBe("1");
    expect(pos(d, 80, 94)).toBe("044000020000002");
    expect(parseNachaFile(f.text).batches[0].entries[1].receiverName).toBe("BETA SUPPLY CO");
  });
});

describe("nacha: control records", () => {
  const file = buildNachaFile(originator, entries, options);
  const recs = lines(file.text);
  const batchControl = recs.find((r) => r[0] === "8")!;
  const fileControl = recs[file.records - 1];

  it("entry hash is the sum of the 8-digit receiving DFI ids", () => {
    const expected = String(2100002 + 6100010 + 4400002).padStart(10, "0");
    expect(file.entryHash).toBe(expected);
    expect(pos(batchControl, 11, 20)).toBe(expected);
    expect(pos(fileControl, 22, 31)).toBe(expected);
  });

  it("entry hash keeps only the rightmost 10 digits when the sum overflows", () => {
    const big = Array.from({ length: 101 }, () => "999999992");
    expect(abaCheckDigitValid("999999992")).toBe(true);
    // 101 * 99999999 = 10099999899 (11 digits) -> rightmost 10
    expect(entryHashOf(big)).toBe("0099999899");
    const f = buildNachaFile(
      originator,
      big.map((routing) => ({ routing, accountNumber: "1", amountCents: 1, receiverName: "X", receiverId: "X" })),
      options,
    );
    expect(f.entryHash).toBe("0099999899");
    expect(pos(lines(f.text).find((r) => r[0] === "8")!, 11, 20)).toBe("0099999899");
    expect(pos(lines(f.text)[f.records - 1], 22, 31)).toBe("0099999899");
  });

  it("batch control totals and layout", () => {
    expect(pos(batchControl, 1, 1)).toBe("8");
    expect(pos(batchControl, 2, 4)).toBe("220");
    expect(pos(batchControl, 5, 10)).toBe("000004"); // 3 entries + 1 addenda
    expect(pos(batchControl, 21, 32)).toBe("000000000000");
    expect(pos(batchControl, 33, 44)).toBe("000000512346");
    expect(pos(batchControl, 45, 54)).toBe("1123456789");
    expect(pos(batchControl, 55, 73)).toBe(" ".repeat(19));
    expect(pos(batchControl, 74, 79)).toBe(" ".repeat(6));
    expect(pos(batchControl, 80, 87)).toBe("04400002");
    expect(pos(batchControl, 88, 94)).toBe("0000001");
    expect(file.totalCreditCents).toBe(512346);
  });

  it("file control totals and layout", () => {
    expect(pos(fileControl, 1, 1)).toBe("9");
    expect(pos(fileControl, 2, 7)).toBe("000001");
    expect(pos(fileControl, 8, 13)).toBe("000001");
    expect(pos(fileControl, 14, 21)).toBe("00000004");
    expect(pos(fileControl, 32, 43)).toBe("000000000000");
    expect(pos(fileControl, 44, 55)).toBe("000000512346");
    expect(pos(fileControl, 56, 94)).toBe(" ".repeat(39));
  });
});

describe("nacha: validation", () => {
  it("ABA 3-7-1 checksum accepts real routings and rejects a transposition", () => {
    expect(abaCheckDigitValid("021000021")).toBe(true);
    expect(abaCheckDigitValid("044000024")).toBe(true);
    expect(abaCheckDigitValid("021000012")).toBe(false);
    expect(abaCheckDigitValid("02100002")).toBe(false);
    expect(abaCheckDigitValid("02100002a")).toBe(false);
  });

  it("rejects bad routing numbers, amounts, account numbers and entry counts", () => {
    const build = (patch: Partial<NachaEntry>) => () => buildNachaFile(originator, [{ ...entries[0], ...patch }], options);
    expect(build({ routing: "021000012" })).toThrow(/check-digit/);
    expect(build({ routing: "21000021" })).toThrow(/exactly 9 digits/);
    expect(build({ amountCents: 0 })).toThrow(/positive integer/);
    expect(build({ amountCents: -5 })).toThrow(/positive integer/);
    expect(build({ amountCents: 12.5 })).toThrow(/positive integer/);
    expect(build({ accountNumber: "" })).toThrow(/1\.\.17 digits/);
    expect(build({ accountNumber: "123456789012345678" })).toThrow(/1\.\.17 digits/);
    expect(build({ accountNumber: "12-34" })).toThrow(/1\.\.17 digits/);
    expect(() => buildNachaFile({ ...originator, odfiRouting: "044000042" }, entries, options)).toThrow(/odfiRouting/);
    expect(() => buildNachaFile(originator, [], options)).toThrow(/at least one entry/);
    const tooMany = { length: 10_000_000 } as unknown as NachaEntry[];
    expect(() => buildNachaFile(originator, tooMany, options)).toThrow(/too many entries/);
  });

  it("micro-entry builder rejects $1.00 and debits, and forces ACCTVERIFY", () => {
    const micro = [
      { routing: "021000021", accountNumber: "987654321", amountCents: 37, receiverName: "ABC Manufacturing", receiverId: "VEND-001" },
      { routing: "021000021", accountNumber: "987654321", amountCents: 52, receiverName: "ABC Manufacturing", receiverId: "VEND-001" },
    ];
    const opts = { secCode: "CCD" as const, effectiveDate: options.effectiveDate, createdAt: options.createdAt, entryDescription: "VENDOR PAY" };
    const f = buildMicroEntryFile(originator, micro, opts);
    expect(MICRO_ENTRY_DESCRIPTION).toBe("ACCTVERIFY");
    expect(pos(lines(f.text)[1], 54, 63)).toBe("ACCTVERIFY");
    expect(f.totalCreditCents).toBe(89);
    expect(() => buildMicroEntryFile(originator, [{ ...micro[0], amountCents: 100 }], opts)).toThrow(/between 1 and 99 cents/);
    expect(() => buildMicroEntryFile(originator, [{ ...micro[0], amountCents: 0 }], opts)).toThrow(/between 1 and 99 cents/);
    expect(() => buildMicroEntryFile(originator, micro, { ...opts, transactionCode: "23" })).toThrow(/credits/);
    expect(pos(lines(buildMicroEntryFile(originator, micro, { ...opts, transactionCode: "32" }).text)[2], 2, 3)).toBe("32");
  });
});

describe("nacha: masking and parsing", () => {
  const file = buildNachaFile(originator, entries, options);
  const masked = maskNachaFile(file.text);

  it("masking changes only positions 13-29 of type-6 records and keeps the last 4 digits", () => {
    const before = lines(file.text);
    const after = lines(masked);
    expect(after).toHaveLength(before.length);
    before.forEach((b, i) => {
      const a = after[i];
      expect(a).toHaveLength(94);
      if (b[0] !== "6") {
        expect(a).toBe(b);
        return;
      }
      expect(pos(a, 1, 12)).toBe(pos(b, 1, 12));
      expect(pos(a, 30, 94)).toBe(pos(b, 30, 94));
    });
    const details = after.filter((r) => r[0] === "6");
    expect(pos(details[0], 13, 29)).toBe("*****4321        ");
    expect(pos(details[1], 13, 29)).toBe("*************4567");
    expect(pos(details[2], 13, 29)).toBe("55               ");
    expect(masked).not.toContain("987654321");
    expect(maskNachaFile(masked)).toBe(masked);
  });

  it("parse(build(x)) round-trips amounts, traces, names and addenda", () => {
    const parsed = parseNachaFile(file.text);
    expect(parsed.header.immediateDestination).toBe("021000021");
    expect(parsed.header.immediateOrigin).toBe("1123456789");
    expect(parsed.header.fileCreationDate).toBe("261025");
    expect(parsed.header.recordSize).toBe("094");
    expect(parsed.batches).toHaveLength(1);
    const batch = parsed.batches[0];
    expect(batch.header.serviceClassCode).toBe("220");
    expect(batch.header.secCode).toBe("CCD");
    expect(batch.header.entryDescription).toBe("VENDOR PAY");
    expect(batch.header.effectiveDate).toBe("261027");
    expect(batch.entries.map((e) => e.amountCents)).toEqual(entries.map((e) => e.amountCents));
    expect(batch.entries.map((e) => e.traceNumber)).toEqual(file.traceNumbers);
    expect(batch.entries.map((e) => e.routing)).toEqual(entries.map((e) => e.routing));
    expect(batch.entries.map((e) => e.account)).toEqual(entries.map((e) => e.accountNumber));
    expect(batch.entries.map((e) => e.receiverName)).toEqual(entries.map((e) => e.receiverName.toUpperCase()));
    expect(batch.entries.map((e) => e.receiverId)).toEqual(entries.map((e) => e.receiverId));
    expect(batch.entries[0].addenda).toBeUndefined();
    expect(batch.entries[1].addenda).toEqual({ typeCode: "05", info: "INV-2026-0558", sequence: "0001", entryDetailSequence: "0000002" });
    expect(batch.control).toEqual({
      serviceClassCode: "220",
      entryAddendaCount: 4,
      entryHash: file.entryHash,
      totalDebitCents: 0,
      totalCreditCents: 512346,
      companyId: "1123456789",
      odfiId: "04400002",
      batchNumber: 1,
    });
    expect(parsed.control).toEqual({
      batchCount: 1,
      blockCount: 1,
      entryAddendaCount: 4,
      entryHash: file.entryHash,
      totalDebitCents: 0,
      totalCreditCents: 512346,
    });
    expect(parsed.paddingLines).toBe(2);
  });

  it("parsing a masked file flags masked accounts", () => {
    const parsed = parseNachaFile(masked);
    expect(parsed.batches[0].entries[0]).toMatchObject({ account: "*****4321", accountMasked: true });
    expect(parsed.batches[0].entries[2]).toMatchObject({ account: "55", accountMasked: false });
    expect(parsed.batches[0].entries.map((e) => e.amountCents)).toEqual([500000, 12345, 1]);
  });
});

// ------------------------------------------------------------------ pain.001

/** Minimal well-formedness check: every open tag is closed in order. */
function tagsBalanced(xml: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)[^<>]*?(\/?)>/g;
  const body = xml.replace(/<\?xml[^>]*\?>/, "");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const [, closing, name, selfClosing] = m;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

const pain: Pain001Input = {
  msgId: "LANDED-20261025-0001",
  createdAt: new Date(Date.UTC(2026, 9, 25, 9, 30, 0, 123)),
  initiatingParty: "Acme Corp",
  debtor: { name: "Acme Corp", accountNumber: "123456789", routing: "044000024" },
  requestedExecutionDate: new Date(Date.UTC(2026, 9, 27)),
  payments: [
    {
      endToEndId: "INV-2026-0558",
      instructionId: "INSTR-0001",
      amountCents: 500000,
      currency: "USD",
      creditor: { name: "ABC Manufacturing Inc", addressLines: ["789 Industrial Pkwy, Columbus OH 43215"], country: "US" },
      creditorAccount: { accountNumber: "987654321" },
      creditorAgent: { routing: "021000021" },
      remittance: "Invoice INV-2026-0558",
      purpose: "SUPP",
    },
    {
      endToEndId: "INV-2026-0559",
      amountCents: 12345,
      creditor: { name: "Smith & Sons <Holdings>" },
      creditorAccount: { iban: "DE89370400440532013000" },
      creditorAgent: { bic: "COBADEFFXXX" },
    },
  ],
};

describe("pain.001.001.03", () => {
  const result = buildPain001(pain);

  it("is well-formed and declares the pain.001.001.03 namespace", () => {
    expect(tagsBalanced(result.xml)).toBe(true);
    expect(result.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(result.xml).toContain(`<Document xmlns="${PAIN001_NAMESPACE}"`);
    expect(PAIN001_NAMESPACE).toBe("urn:iso:std:iso:20022:tech:xsd:pain.001.001.03");
    expect(result.xml).toContain("<CstmrCdtTrfInitn>");
  });

  it("NbOfTxs and CtrlSum are correct in both GrpHdr and PmtInf", () => {
    expect(result.nbOfTxs).toBe(2);
    expect(result.ctrlSum).toBe("5123.45");
    expect(result.xml.match(/<NbOfTxs>2<\/NbOfTxs>/g)).toHaveLength(2);
    expect(result.xml.match(/<CtrlSum>5123\.45<\/CtrlSum>/g)).toHaveLength(2);
    expect(result.xml).toContain('<InstdAmt Ccy="USD">5000.00</InstdAmt>');
    expect(result.xml).toContain('<InstdAmt Ccy="USD">123.45</InstdAmt>');
  });

  it("emits the required group header and payment information fields", () => {
    const x = result.xml;
    expect(x).toContain("<MsgId>LANDED-20261025-0001</MsgId>");
    expect(x).toContain("<CreDtTm>2026-10-25T09:30:00Z</CreDtTm>");
    expect(x).toMatch(/<InitgPty>\s*<Nm>Acme Corp<\/Nm>\s*<\/InitgPty>/);
    expect(x).toContain("<PmtInfId>LANDED-20261025-0001-1</PmtInfId>");
    expect(x).toContain("<PmtMtd>TRF</PmtMtd>");
    expect(x).toContain("<BtchBookg>false</BtchBookg>");
    expect(x).toMatch(/<SvcLvl>\s*<Cd>NURG<\/Cd>\s*<\/SvcLvl>/);
    expect(x).toMatch(/<LclInstrm>\s*<Cd>CCD<\/Cd>\s*<\/LclInstrm>/);
    expect(x).toContain("<ReqdExctnDt>2026-10-27</ReqdExctnDt>");
    expect(x).toMatch(/<Dbtr>\s*<Nm>Acme Corp<\/Nm>\s*<\/Dbtr>/);
    expect(x).toMatch(/<DbtrAcct>\s*<Id>\s*<Othr>\s*<Id>123456789<\/Id>\s*<\/Othr>\s*<\/Id>\s*<Ccy>USD<\/Ccy>\s*<\/DbtrAcct>/);
    expect(x).toMatch(/<DbtrAgt>\s*<FinInstnId>\s*<ClrSysMmbId>\s*<ClrSysId>\s*<Cd>USABA<\/Cd>\s*<\/ClrSysId>\s*<MmbId>044000024<\/MmbId>/);
    expect(x).toContain("<ChrgBr>SLEV</ChrgBr>");
    // XSD order inside PmtInf: ... DbtrAgt, ChrgBr, CdtTrfTxInf
    expect(x.indexOf("<DbtrAgt>")).toBeLessThan(x.indexOf("<ChrgBr>"));
    expect(x.indexOf("<ChrgBr>")).toBeLessThan(x.indexOf("<CdtTrfTxInf>"));
  });

  it("emits a credit transfer per payment with agent, creditor, account, purpose and remittance", () => {
    const x = result.xml;
    expect(x.match(/<CdtTrfTxInf>/g)).toHaveLength(2);
    expect(x).toMatch(/<PmtId>\s*<InstrId>INSTR-0001<\/InstrId>\s*<EndToEndId>INV-2026-0558<\/EndToEndId>\s*<\/PmtId>/);
    expect(x).toMatch(/<CdtrAgt>\s*<FinInstnId>\s*<ClrSysMmbId>\s*<ClrSysId>\s*<Cd>USABA<\/Cd>\s*<\/ClrSysId>\s*<MmbId>021000021<\/MmbId>/);
    expect(x).toMatch(/<Cdtr>\s*<Nm>ABC Manufacturing Inc<\/Nm>\s*<PstlAdr>\s*<Ctry>US<\/Ctry>\s*<AdrLine>789 Industrial Pkwy, Columbus OH 43215<\/AdrLine>/);
    expect(x).toMatch(/<CdtrAcct>\s*<Id>\s*<Othr>\s*<Id>987654321<\/Id>/);
    expect(x).toMatch(/<Purp>\s*<Cd>SUPP<\/Cd>\s*<\/Purp>/);
    expect(x).toMatch(/<RmtInf>\s*<Ustrd>Invoice INV-2026-0558<\/Ustrd>\s*<\/RmtInf>/);
    // second payment: BIC agent, IBAN account, no InstrId / Purp / RmtInf
    expect(x).toMatch(/<FinInstnId>\s*<BIC>COBADEFFXXX<\/BIC>\s*<\/FinInstnId>/);
    expect(x).toMatch(/<CdtrAcct>\s*<Id>\s*<IBAN>DE89370400440532013000<\/IBAN>/);
    expect(x.match(/<InstrId>/g)).toHaveLength(1);
    expect(x.match(/<Purp>/g)).toHaveLength(1);
    expect(x.match(/<RmtInf>/g)).toHaveLength(1);
  });

  it("escapes & and < in text content", () => {
    expect(result.xml).toContain("<Nm>Smith &amp; Sons &lt;Holdings&gt;</Nm>");
    expect(result.xml).not.toContain("Smith & Sons");
    expect(tagsBalanced(result.xml)).toBe(true);
  });

  it("truncates Max35Text identifiers", () => {
    const long = "X".repeat(50);
    const r = buildPain001({ ...pain, msgId: long, payments: [{ ...pain.payments[0], endToEndId: long, instructionId: long }] });
    expect(r.xml).toContain(`<MsgId>${"X".repeat(35)}</MsgId>`);
    expect(r.xml).toContain(`<EndToEndId>${"X".repeat(35)}</EndToEndId>`);
    expect(r.xml).toContain(`<InstrId>${"X".repeat(35)}</InstrId>`);
    expect(r.xml).toContain(`<PmtInfId>${"X".repeat(35)}</PmtInfId>`);
    expect(r.xml).not.toContain("X".repeat(36));
  });

  it("throws on empty payments, non-positive amounts, missing EndToEndId and missing account/agent ids", () => {
    expect(() => buildPain001({ ...pain, payments: [] })).toThrow(/at least one payment/);
    expect(() => buildPain001({ ...pain, payments: [{ ...pain.payments[0], amountCents: 0 }] })).toThrow(/positive integer/);
    expect(() => buildPain001({ ...pain, payments: [{ ...pain.payments[0], amountCents: 10.5 }] })).toThrow(/positive integer/);
    expect(() => buildPain001({ ...pain, payments: [{ ...pain.payments[0], endToEndId: "" }] })).toThrow(/endToEndId/);
    expect(() => buildPain001({ ...pain, payments: [{ ...pain.payments[0], creditorAccount: {} }] })).toThrow(/accountNumber or iban/);
    expect(() => buildPain001({ ...pain, payments: [{ ...pain.payments[0], creditorAgent: {} }] })).toThrow(/routing or bic/);
    expect(() => buildPain001({ ...pain, debtor: { name: "Acme", accountNumber: "1", routing: "12345" } })).toThrow(/9 digits/);
  });

  it("masking hides all but the last 4 of debtor and creditor accounts and keeps the XML well-formed", () => {
    const masked = maskPain001(result.xml);
    expect(tagsBalanced(masked)).toBe(true);
    expect(masked).toMatch(/<DbtrAcct>\s*<Id>\s*<Othr>\s*<Id>\*\*\*\*6789<\/Id>/);
    expect(masked).toMatch(/<CdtrAcct>\s*<Id>\s*<Othr>\s*<Id>\*\*\*\*4321<\/Id>/);
    expect(masked).toMatch(/<CdtrAcct>\s*<Id>\s*<IBAN>\*\*\*\*3000<\/IBAN>/);
    expect(masked).not.toContain("123456789");
    expect(masked).not.toContain("987654321");
    expect(masked).not.toContain("DE89370400440532013000");
    // routing numbers, ids, amounts and names are untouched
    expect(masked).toContain("<MmbId>044000024</MmbId>");
    expect(masked).toContain("<MmbId>021000021</MmbId>");
    expect(masked).toContain("<EndToEndId>INV-2026-0558</EndToEndId>");
    expect(masked).toContain('<InstdAmt Ccy="USD">5000.00</InstdAmt>');
    expect(masked.split("\n")).toHaveLength(result.xml.split("\n").length);
  });
});
