// Hand-built docs for pure-function tests. Ids are opaque strings cast to Id.
import type { Doc, Id } from "../convex/_generated/dataModel";

export const id = <T extends string>(s: string) => s as unknown as Id<T>;

export const vendorA = id<"vendors">("vendorA");
export const vendorB = id<"vendors">("vendorB");
export const caseA = id<"cases">("caseA");
export const caseB = id<"cases">("caseB");
export const probeA = id<"probes">("probeA");
export const probeB = id<"probes">("probeB");
export const contactA = id<"contacts">("contactA");
export const accountA = id<"bankAccounts">("accountA");
export const accountB = id<"bankAccounts">("accountB");
export const invoiceA = id<"invoices">("invoiceA");
export const confA = id<"confirmations">("confA");

export const T0 = 1_800_000_000_000;

export function mkAccount(over: Partial<Doc<"bankAccounts">> = {}): Doc<"bankAccounts"> {
  return {
    _id: accountA,
    _creationTime: T0,
    vendorId: vendorA,
    identityKey: `${vendorA}:hashA`,
    version: 1,
    routing: "021000021",
    accountLast4: "4321",
    accountHash: "hashA",
    accountCiphertext: "ct",
    status: "verified",
    createdVia: "seed",
    ...over,
  };
}

export function mkInvoice(over: Partial<Doc<"invoices">> = {}): Doc<"invoices"> {
  return {
    _id: invoiceA,
    _creationTime: T0,
    vendorId: vendorA,
    number: "INV-1",
    amountCents: 4_200_000,
    issuedAt: T0,
    dueAt: T0 + 86400000 * 6,
    remitAccountId: accountA,
    status: "open",
    ...over,
  };
}

export function mkCase(over: Partial<Doc<"cases">> = {}): Doc<"cases"> {
  return {
    _id: caseA,
    _creationTime: T0,
    vendorId: vendorA,
    triggerType: "instruction_change",
    newAccountId: accountA,
    state: "AWAITING_CONFIRMATION",
    probeId: probeA,
    contactAlsoChanged: false,
    openedAt: T0,
    ...over,
  };
}

export function mkProbe(over: Partial<Doc<"probes">> = {}): Doc<"probes"> {
  return {
    _id: probeA,
    _creationTime: T0,
    caseId: caseA,
    accountId: accountA,
    accountHash: "hashA",
    amountCents: 37,
    idempotencyKey: `probe:${caseA}`,
    state: "available",
    submittedAt: T0,
    settledAt: T0 + 3600_000,
    availableAt: T0 + 7200_000,
    ...over,
  };
}

export function mkConfirmation(over: Partial<Doc<"confirmations">> = {}): Doc<"confirmations"> {
  return {
    _id: confA,
    _creationTime: T0,
    caseId: caseA,
    vendorId: vendorA,
    accountHash: "hashA",
    accountVersion: 1,
    probeId: probeA,
    channel: "sim_voice",
    contactId: contactA,
    statedAmountCents: 37,
    receivedAt: T0 + 7300_000,
    expiresAt: T0 + 7300_000 + 2 * 3600_000,
    accepted: true,
    ...over,
  };
}

export function mkContact(over: Partial<Doc<"contacts">> = {}): Doc<"contacts"> {
  return {
    _id: contactA,
    _creationTime: T0,
    vendorId: vendorA,
    kind: "phone",
    value: "+15550100001",
    trustLevel: "record",
    establishedAt: T0 - 86400000 * 400,
    establishedVia: "onboarding_form_and_verified_call",
    ...over,
  };
}
