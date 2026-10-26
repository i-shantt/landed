"use client";
// Data hooks. Pages import these (and landed components) only.
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function useClock() {
  return useQuery(api.clock.get, {});
}
/** Demo-clock now; 0 while loading. */
export function useNow(): number {
  return useClock()?.now ?? 0;
}
export function useSettings() {
  return useQuery(api.settings.all, {});
}
export function useHealth() {
  return useQuery(api.health.status, {});
}
export function useEnvPresence() {
  return useQuery(api.env.presence, {});
}
export function useNextTimers() {
  return useQuery(api.timerQueries.nextByKind, {});
}
export function useCases() {
  return useQuery(api.cases.list, {});
}
export function useCase(caseId: Id<"cases">) {
  return useQuery(api.cases.get, { caseId });
}
export function useCaseEvents(caseId: Id<"cases">, enabled = true) {
  return useQuery(api.events.listForCase, enabled ? { caseId } : "skip");
}
export function useProbe(caseId: Id<"cases">) {
  return useQuery(api.probes.getPublic, { caseId });
}
export function useConfirmations(caseId: Id<"cases">) {
  return useQuery(api.confirmations.listForCase, { caseId });
}
export function usePackage(caseId: Id<"cases">) {
  return useQuery(api.package.getForCase, { caseId });
}
export function useVendors() {
  return useQuery(api.vendors.list, {});
}
export function useVendor(vendorId: Id<"vendors">) {
  return useQuery(api.vendors.get, { vendorId });
}
export function useMessages() {
  return useQuery(api.messages.list, {});
}
export function useEvalRuns() {
  return useQuery(api.evalRuns.list, {});
}
export function useSeedStatus() {
  return useQuery(api.seed.status, {});
}
export function usePortalRequests(sessionToken: string | null | undefined) {
  return useQuery(api.channels.portal.openRequestsForSession, sessionToken ? { sessionToken } : "skip");
}
export function usePortalToken(sessionToken: string | null | undefined, token: string) {
  return useQuery(api.channels.portal.tokenInfo, sessionToken ? { sessionToken, token } : "skip");
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
export function usePortalActions() {
  return { login: useAction(api.portalAuth.login), confirm: useMutation(api.channels.portal.confirm) };
}

// ---- Phase C additions ----
export function useJudgeScenarios() {
  return useQuery(api.judge.scenarios, {});
}
export function useJudgeRun(runId: string | null) {
  return useQuery(api.judge.get, runId ? { runId } : "skip");
}
export function useJudgeRecent() {
  return useQuery(api.judge.recent, {});
}
export function useJudgeActions() {
  return { run: useAction(api.judge.run) };
}
export function useExplain() {
  return useAction(api.explain.narrate);
}
export function useCaseExport(caseId: Id<"cases">, enabled = true) {
  return useQuery(api.exportCase.caseExport, enabled ? { caseId } : "skip");
}
export function useNessieTransfers() {
  return useAction(api.nessieViewer.transfers);
}
export function useDevTools() {
  return { simulateDiscovery: useMutation(api.devTools.simulateDiscovery) };
}

export function useDemoNextStep(caseId: Id<"cases">) {
  return useQuery(api.demoControls.nextStep, { caseId });
}
export function useFastForward() {
  return useMutation(api.demoControls.fastForward);
}

// ---- run 3, Phase G ----
export function usePaymentRun() {
  return useQuery(api.paymentRun.preview, {});
}
export function useSendPayment() {
  return useMutation(api.payments.send);
}
export function useAuditEvents(args: { vendorId?: Id<"vendors">; caseId?: Id<"cases">; actor?: string; type?: string; from?: number; to?: number; limit?: number }) {
  return useQuery(api.audit.events, args);
}
export function useAuditChain() {
  return useAction(api.audit.chain);
}
export function useEmlIngest() {
  return useAction(api.emlIntake.ingest);
}

// ---- controls layer: operators, approvals, policy ----
export function useApprovals(status?: "pending" | "approved" | "rejected" | "consumed") {
  return useQuery(api.controls.approvals.list, status ? { status } : {});
}
export function usePendingApprovalCount(): number {
  return useQuery(api.controls.approvals.list, { status: "pending" })?.length ?? 0;
}
export function useApprovalActions() {
  return { request: useMutation(api.controls.approvals.request), decide: useMutation(api.controls.approvals.decide) };
}
export function usePolicy() {
  return useQuery(api.controls.policy.get, {});
}
export function usePolicyActions() {
  return { set: useMutation(api.controls.policy.set), applyRecommended: useMutation(api.controls.policy.applyRecommended) };
}
export function useOperatorAdmin() {
  return { create: useMutation(api.controls.operators.create), deactivate: useMutation(api.controls.operators.deactivate) };
}

// ---- dashboard, payments ledger ----
export function useOverview() {
  return useQuery(api.analytics.overview, {});
}
export function useAttention() {
  return useQuery(api.analytics.attention, {});
}
export function useRecentEvents() {
  return useQuery(api.events.recent, {});
}
export function usePaymentsDetailed() {
  return useQuery(api.paymentQueries.listDetailed, {});
}
export function useAttestLanded() {
  return useMutation(api.payments.attestLanded);
}

// ---- risk engine ----
export function useRisk(caseId: Id<"cases">) {
  return useQuery(api.risk.assess.forCase, { caseId });
}
export function useRiskForAll() {
  return useQuery(api.risk.assess.forAll, {});
}

export function useOnboarding() {
  return {
    createVendor: useMutation(api.onboarding.createVendor),
    attestRecordContact: useMutation(api.onboarding.attestRecordContact),
    addFirstAccount: useAction(api.onboarding.addFirstAccount),
    issuePortalCredential: useAction(api.onboarding.issuePortalCredential),
  };
}
