"use client";
// Data hooks. Pages import these (and landed components) only.
import { useAction, useConvexAuth, useMutation, useQuery, type OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * useQuery for workspace reads. Every workspace query requires an operator session on the server, so the
 * subscription is skipped until the Convex client holds the session token and again after sign-out; the
 * component sees `undefined` (loading) instead of an auth error. Public reads (health, eval runs, demo-case
 * ids) keep plain useQuery.
 */
function useAuthedQuery<Q extends FunctionReference<"query">>(query: Q, ...args: OptionalRestArgsOrSkip<Q>): FunctionReturnType<Q> | undefined {
  const { isAuthenticated } = useConvexAuth();
  const skip = ["skip"] as unknown as OptionalRestArgsOrSkip<Q>;
  return useQuery(query, ...(isAuthenticated ? args : skip));
}

export function useClock() {
  return useAuthedQuery(api.clock.get, {});
}
/** Demo-clock now; 0 while loading. */
export function useNow(): number {
  return useClock()?.now ?? 0;
}
export function useSettings() {
  return useAuthedQuery(api.settings.all, {});
}
export function useHealth() {
  return useQuery(api.health.status, {});
}
export function useEnvPresence() {
  return useAuthedQuery(api.env.presence, {});
}
export function useNextTimers() {
  return useAuthedQuery(api.timerQueries.nextByKind, {});
}
export function useCases() {
  return useAuthedQuery(api.cases.list, {});
}
export function useCase(caseId: Id<"cases">) {
  return useAuthedQuery(api.cases.get, { caseId });
}
export function useCaseEvents(caseId: Id<"cases">, enabled = true) {
  return useAuthedQuery(api.events.listForCase, enabled ? { caseId } : "skip");
}
export function useProbe(caseId: Id<"cases">) {
  return useAuthedQuery(api.probes.getPublic, { caseId });
}
export function useConfirmations(caseId: Id<"cases">) {
  return useAuthedQuery(api.confirmations.listForCase, { caseId });
}
export function usePackage(caseId: Id<"cases">) {
  return useAuthedQuery(api.package.getForCase, { caseId });
}
export function useVendors() {
  return useAuthedQuery(api.vendors.list, {});
}
export function useVendor(vendorId: Id<"vendors">) {
  return useAuthedQuery(api.vendors.get, { vendorId });
}
export function useMessages() {
  return useAuthedQuery(api.messages.list, {});
}
export function useEvalRuns() {
  return useQuery(api.evalRuns.list, {});
}
/** Seeded demo-case ids as a JSON string (public: the pitch deck deep-links them). */
export function useDemoCases() {
  return useQuery(api.settings.demoCases, {});
}
export function useSeedStatus() {
  return useAuthedQuery(api.seed.status, {});
}

// Mutations / actions (human-initiated).
export function useClockControls() {
  return { advance: useMutation(api.clock.advance), advanceTo: useMutation(api.clock.advanceTo), setMode: useMutation(api.clock.setMode) };
}
export function useSetSetting() {
  return useMutation(api.settings.set);
}
export function useReseed() {
  return useAction(api.seed.reseed);
}
export function useCaseActions() {
  return {
    pay: useMutation(api.payments.send),
    requestReview: useMutation(api.cases.requestHumanReview),
    markFraud: useMutation(api.cases.markFraud),
    rejectChange: useMutation(api.cases.rejectChange),
    exceptionalRelease: useMutation(api.cases.exceptionalRelease),
    simAnswer: useMutation(api.channels.simVoice.answer),
  };
}
export function useVendorActions() {
  return {
    supersede: useMutation(api.contacts.supersede),
    addRecord: useMutation(api.contacts.addRecordContact),
    manualEdit: useAction(api.bankAccounts.manualEdit),
    discover: useAction(api.discovery.discoverFromWebsite),
  };
}
export function useMailboxActions() {
  return { insert: useMutation(api.messages.insert), generateUploadUrl: useMutation(api.messages.generateUploadUrl) };
}

// ---- Phase C additions ----
export function useJudgeScenarios() {
  return useAuthedQuery(api.judge.scenarios, {});
}
export function useJudgeRun(runId: string | null) {
  return useAuthedQuery(api.judge.get, runId ? { runId } : "skip");
}
export function useJudgeRecent() {
  return useAuthedQuery(api.judge.recent, {});
}
export function useJudgeActions() {
  return { run: useAction(api.judge.run) };
}
export function useExplain() {
  return useAction(api.explain.narrate);
}
export function useCaseExport(caseId: Id<"cases">, enabled = true) {
  return useAuthedQuery(api.exportCase.caseExport, enabled ? { caseId } : "skip");
}
export function useNessieTransfers() {
  return useAction(api.nessieViewer.transfers);
}
export function useDevTools() {
  return { simulateDiscovery: useMutation(api.devTools.simulateDiscovery) };
}

export function useDemoNextStep(caseId: Id<"cases">) {
  return useAuthedQuery(api.demoControls.nextStep, { caseId });
}
export function useFastForward() {
  return useMutation(api.demoControls.fastForward);
}

// ---- run 3, Phase G ----
export function usePaymentRun() {
  return useAuthedQuery(api.paymentRun.preview, {});
}
export function useSendPayment() {
  return useMutation(api.payments.send);
}
export function useAuditEvents(args: { vendorId?: Id<"vendors">; caseId?: Id<"cases">; actor?: string; type?: string; from?: number; to?: number; limit?: number }) {
  return useAuthedQuery(api.audit.events, args);
}
export function useAuditChain() {
  return useAction(api.audit.chain);
}
export function useEmlIngest() {
  return useAction(api.emlIntake.ingest);
}

// ---- controls layer: operators, approvals, policy ----
export function useApprovals(status?: "pending" | "approved" | "rejected" | "consumed") {
  return useAuthedQuery(api.controls.approvals.list, status ? { status } : {});
}
export function usePendingApprovalCount(): number {
  return useAuthedQuery(api.controls.approvals.list, { status: "pending" })?.length ?? 0;
}
export function useApprovalActions() {
  return { request: useMutation(api.controls.approvals.request), decide: useMutation(api.controls.approvals.decide) };
}
export function usePolicy() {
  return useAuthedQuery(api.controls.policy.get, {});
}
export function usePolicyActions() {
  return { set: useMutation(api.controls.policy.set), applyRecommended: useMutation(api.controls.policy.applyRecommended) };
}
/** Active operators (the invite list: an operator signs in with the email recorded here). */
export function useOperators() {
  return useAuthedQuery(api.controls.operators.list, {});
}
export function useOperatorAdmin() {
  return { create: useMutation(api.controls.operators.create), deactivate: useMutation(api.controls.operators.deactivate) };
}

// ---- dashboard, payments ledger ----
export function useOverview() {
  return useAuthedQuery(api.analytics.overview, {});
}
export function useAttention() {
  return useAuthedQuery(api.analytics.attention, {});
}
export function useRecentEvents() {
  return useAuthedQuery(api.events.recent, {});
}
export function usePaymentsDetailed() {
  return useAuthedQuery(api.paymentQueries.listDetailed, {});
}
export function useAttestLanded() {
  return useMutation(api.payments.attestLanded);
}

// ---- screening ----
export function useScreeningForVendor(vendorId: Id<"vendors">) {
  return useAuthedQuery(api.screening.screen.forVendor, { vendorId });
}
export function useScreeningSummary() {
  return useAuthedQuery(api.screening.screen.summary, {});
}
export function useScreeningPending() {
  return useAuthedQuery(api.screening.screen.pending, {});
}
export function useScreeningActions() {
  return { screenVendor: useMutation(api.screening.screen.screenVendor), screenAll: useMutation(api.screening.screen.screenAll), review: useMutation(api.screening.screen.review) };
}

// ---- developers: API keys, webhooks ----
export function useApiKeys() {
  return useAuthedQuery(api.api.keys.list, {});
}
export function useApiKeyActions() {
  return { create: useAction(api.api.keys.create), revoke: useMutation(api.api.keys.revoke) };
}
export function useWebhookEndpoints() {
  return useAuthedQuery(api.webhooks.dispatch.endpoints, {});
}
export function useWebhookDeliveries() {
  return useAuthedQuery(api.webhooks.dispatch.deliveries, { limit: 50 });
}
export function useWebhookInbox() {
  return useAuthedQuery(api.webhooks.dispatch.inbox, {});
}
export function useWebhookActions() {
  return {
    create: useMutation(api.webhooks.dispatch.createEndpoint),
    createInbox: useMutation(api.webhooks.dispatch.createInboxEndpoint),
    setActive: useMutation(api.webhooks.dispatch.setActive),
    remove: useMutation(api.webhooks.dispatch.remove),
    pumpNow: useMutation(api.webhooks.dispatch.pumpNow),
    sendTest: useAction(api.webhooks.dispatch.sendTest),
  };
}

// ---- payment files ----
export function usePaymentFiles() {
  return useAuthedQuery(api.exports.paymentFiles.list, {});
}
export function useBuildPaymentFile() {
  return useAction(api.exports.paymentFiles.build);
}

// ---- risk engine ----
export function useRisk(caseId: Id<"cases">) {
  return useAuthedQuery(api.risk.assess.forCase, { caseId });
}
export function useRiskForAll() {
  return useAuthedQuery(api.risk.assess.forAll, {});
}

// ---- transaction monitoring ----
export function useMonitoring() {
  return useAuthedQuery(api.monitoring.queries.overview, {});
}
export function useModelHealth() {
  return useAuthedQuery(api.monitoring.queries.health, {});
}
export function useModelLabels() {
  return useAuthedQuery(api.monitoring.queries.labels, {});
}
export function useVendorTrust(vendorId: Id<"vendors">) {
  return useAuthedQuery(api.monitoring.queries.vendorTrust, { vendorId });
}

export function useOnboarding() {
  return {
    createVendor: useMutation(api.onboarding.createVendor),
    attestRecordContact: useMutation(api.onboarding.attestRecordContact),
    addFirstAccount: useAction(api.onboarding.addFirstAccount),
    issuePortalCredential: useAction(api.onboarding.issuePortalCredential),
  };
}
