import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const caseState = v.union(
  v.literal("HELD"),
  v.literal("PROBE_SENT"),
  v.literal("AWAITING_CONFIRMATION"),
  v.literal("VERIFIED"),
  v.literal("PAID"),
  v.literal("LANDED"),
  v.literal("NEEDS_HUMAN"),
  v.literal("UNCONFIRMED"),
  v.literal("RECOVERY"),
  v.literal("CLOSED")
);

export const accountStatus = v.union(
  v.literal("unverified"),
  v.literal("probing"),
  v.literal("verified"),
  v.literal("disputed"),
  v.literal("rejected"),
  v.literal("superseded")
);

export const trustLevel = v.union(
  v.literal("record"),
  v.literal("discovered"),
  v.literal("untrusted")
);

export default defineSchema({
  company: defineTable({
    name: v.string(),
    domain: v.string(),
    timezone: v.string(), // "America/Los_Angeles"
    bankRouting: v.optional(v.string()),
    bankLast4: v.optional(v.string()),
  }),

  clock: defineTable({
    mode: v.union(v.literal("live"), v.literal("demo")),
    offsetMs: v.number(), // demo time = Date.now() + offsetMs
  }),

  vendors: defineTable({
    name: v.string(),
    domain: v.string(),
    onboardedAt: v.number(),
    hasPortalLogin: v.boolean(),
    notes: v.optional(v.string()),
    slug: v.optional(v.string()),
  })
    .index("by_domain", ["domain"])
    .index("by_slug", ["slug"]),

  contacts: defineTable({
    vendorId: v.id("vendors"),
    kind: v.union(v.literal("phone"), v.literal("portal"), v.literal("email")),
    value: v.string(),
    trustLevel: trustLevel,
    establishedAt: v.number(),
    establishedVia: v.string(),
    supersededAt: v.optional(v.number()),
  }).index("by_vendor", ["vendorId"]),

  bankAccounts: defineTable({
    vendorId: v.id("vendors"),
    identityKey: v.string(), // `${vendorId}:${accountHash}`
    version: v.number(),
    routing: v.string(),
    accountLast4: v.string(),
    accountHash: v.string(),
    accountCiphertext: v.string(), // server-only
    status: accountStatus,
    verifiedByConfirmationId: v.optional(v.id("confirmations")),
    firstPaidAt: v.optional(v.number()),
    createdVia: v.string(), // "seed" | "intake" | "manual_edit"
  })
    .index("by_vendor", ["vendorId"])
    .index("by_identity", ["identityKey", "version"])
    .index("by_hash", ["accountHash"]),

  messages: defineTable({
    vendorId: v.optional(v.id("vendors")),
    threadId: v.string(),
    from: v.string(),
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    sentAt: v.number(),
    channel: v.literal("email"),
    authResult: v.object({ spf: v.boolean(), dkim: v.boolean(), dmarc: v.boolean() }),
    attachmentStorageIds: v.array(v.id("_storage")),
    intakeStatus: v.union(v.literal("pending"), v.literal("done"), v.literal("error")),
    intakeResult: v.optional(v.any()),
  }).index("by_thread", ["threadId"]),

  invoices: defineTable({
    vendorId: v.id("vendors"),
    messageId: v.optional(v.id("messages")),
    number: v.string(),
    amountCents: v.number(),
    issuedAt: v.number(),
    dueAt: v.number(),
    remitAccountId: v.id("bankAccounts"),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("held")),
  })
    .index("by_vendor", ["vendorId"])
    .index("by_number", ["number"]),

  cases: defineTable({
    vendorId: v.id("vendors"),
    triggerType: v.string(),
    triggerMessageId: v.optional(v.id("messages")),
    oldAccountId: v.optional(v.id("bankAccounts")),
    newAccountId: v.id("bankAccounts"),
    state: caseState,
    probeId: v.optional(v.id("probes")),
    confirmationId: v.optional(v.id("confirmations")),
    paymentId: v.optional(v.id("payments")),
    contactAlsoChanged: v.boolean(),
    validationProviderResult: v.optional(v.string()),
    slaDeadlineAt: v.optional(v.number()),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    humanReason: v.optional(v.string()),
  })
    .index("by_vendor", ["vendorId"])
    .index("by_state", ["state"])
    .index("by_newAccount", ["newAccountId"]),

  probes: defineTable({
    caseId: v.id("cases"),
    accountId: v.id("bankAccounts"),
    accountHash: v.string(),
    amountCents: v.number(), // SECRET: never exposed by public queries
    idempotencyKey: v.string(),
    railRef: v.optional(v.string()),
    state: v.union(
      v.literal("submitted"),
      v.literal("settled"),
      v.literal("available"),
      v.literal("returned")
    ),
    submittedAt: v.number(),
    settledAt: v.optional(v.number()),
    availableAt: v.optional(v.number()),
  })
    .index("by_case", ["caseId"])
    .index("by_key", ["idempotencyKey"]),

  confirmations: defineTable({
    caseId: v.id("cases"),
    vendorId: v.id("vendors"),
    accountHash: v.string(),
    accountVersion: v.number(),
    probeId: v.optional(v.id("probes")),
    channel: v.union(
      v.literal("voice"),
      v.literal("portal"),
      v.literal("email"),
      v.literal("sim_voice")
    ),
    contactId: v.optional(v.id("contacts")),
    statedAmountCents: v.optional(v.number()),
    transcript: v.optional(v.string()),
    receivedAt: v.number(),
    expiresAt: v.number(),
    accepted: v.boolean(),
    rejectReason: v.optional(v.string()),
    usedAt: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("probe"), v.literal("landing"))),
  }).index("by_case", ["caseId"]),

  payments: defineTable({
    caseId: v.optional(v.id("cases")),
    invoiceId: v.id("invoices"),
    vendorId: v.id("vendors"),
    destinationAccountId: v.id("bankAccounts"),
    amountCents: v.number(),
    rail: v.union(v.literal("ach"), v.literal("wire")),
    idempotencyKey: v.string(),
    railRef: v.optional(v.string()),
    sentAt: v.number(),
    landingState: v.union(v.literal("pending"), v.literal("landed"), v.literal("unconfirmed")),
    landingDeadlineAt: v.number(),
    initiatedBy: v.string(),
  })
    .index("by_invoice", ["invoiceId"])
    .index("by_key", ["idempotencyKey"])
    .index("by_case", ["caseId"]),

  events: defineTable({
    caseId: v.optional(v.id("cases")),
    at: v.number(),
    actor: v.union(
      v.literal("agent"),
      v.literal("human"),
      v.literal("rail"),
      v.literal("vendor"),
      v.literal("system")
    ),
    type: v.string(),
    payload: v.any(),
  }).index("by_case", ["caseId"]),

  timers: defineTable({
    caseId: v.optional(v.id("cases")),
    kind: v.string(),
    dueAt: v.number(),
    fired: v.boolean(),
    payload: v.optional(v.any()),
  })
    .index("by_due", ["fired", "dueAt"])
    .index("by_case", ["caseId"]),

  packages: defineTable({
    caseId: v.id("cases"),
    generatedAt: v.number(),
    fields: v.any(),
    markdown: v.string(),
  }).index("by_case", ["caseId"]),

  portalCredentials: defineTable({
    vendorId: v.id("vendors"),
    username: v.string(),
    passwordHash: v.string(),
    contactId: v.id("contacts"),
  }).index("by_username", ["username"]),

  portalSessions: defineTable({
    vendorId: v.id("vendors"),
    contactId: v.id("contacts"),
    token: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  confirmTokens: defineTable({
    caseId: v.id("cases"),
    vendorId: v.id("vendors"),
    token: v.string(),
    attemptsLeft: v.number(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_case", ["caseId"]),

  simLedger: defineTable({
    accountKey: v.string(),
    entries: v.array(
      v.object({
        ref: v.string(),
        amountCents: v.number(),
        memo: v.string(),
        submittedAt: v.number(),
        settledAt: v.optional(v.number()),
        availableAt: v.optional(v.number()),
        state: v.string(),
      })
    ),
  }).index("by_account", ["accountKey"]),

  evalRuns: defineTable({
    scenarioId: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    expected: v.any(),
    actual: v.any(),
    passed: v.optional(v.boolean()),
    metrics: v.optional(v.any()),
  }).index("by_scenario", ["scenarioId"]),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
