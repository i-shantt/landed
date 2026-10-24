import type { Doc } from "../_generated/dataModel";

export interface ConfirmationChannel {
  name: "sim_voice" | "voice" | "portal";
  /**
   * Ask the contact of record what amount arrived. For mode "probe" the expected
   * amount is NEVER passed (I7). For mode "landing" the payment amount may be
   * passed because it is not secret.
   */
  initiate(args: {
    caseId: string;
    contact: Doc<"contacts">;
    mode: "probe" | "landing";
    expectedPaymentAmountCents?: number;
    paymentId?: string;
  }): Promise<void>;
}
