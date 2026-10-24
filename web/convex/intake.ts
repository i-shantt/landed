"use node";
// Intake orchestration. Runs in Node (PDF parsing, Anthropic SDK). This action
// can ONLY: read the message, call an extractor, and call bankAccounts.createUnverified
// (which opens a case) or record an untrusted contact / rejected email receipt
// claim. It never touches verification, payments, or account status (I5).
import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { extractWithRules, type Extraction } from "./extractors/rules";
import { extractWithClaude } from "./extractors/claude";

export const run = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const info = await ctx.runQuery(internal.intakeQueries.messageContext, { messageId });
    if (!info) return;
    const mode = info.extractorMode;
    if (mode === "off") {
      await ctx.runMutation(internal.messages.setIntakeResult, { messageId, status: "done", result: { changed: false, mode: "off" } });
      return;
    }

    // Gather attachment text (PDF text layer) if any.
    let attachmentText = info.attachmentText ?? "";
    const pdfs: { data: string; name: string }[] = [];
    for (const sid of info.attachmentStorageIds) {
      try {
        const blob = await ctx.storage.get(sid);
        if (!blob) continue;
        const buf = Buffer.from(await blob.arrayBuffer());
        pdfs.push({ data: buf.toString("base64"), name: String(sid) });
        try {
          // pdf-parse v2 (pdfjs-dist): reads pdf-lib and cupsfilter output alike.
          // Convex's Node runtime has no DOM globals; pdfjs-dist touches these at import time.
          const g = globalThis as unknown as Record<string, unknown>;
          if (!g.DOMMatrix) g.DOMMatrix = class DOMMatrix { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; constructor(init?: number[]) { if (Array.isArray(init) && init.length >= 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number]; } };
          if (!g.ImageData) g.ImageData = class ImageData { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
          if (!g.Path2D) g.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} closePath() {} };
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: buf });
          try {
            const parsed = await parser.getText();
            attachmentText += "\n" + (parsed.text ?? "");
          } finally {
            await parser.destroy();
          }
        } catch (e) {
          console.warn("[intake] pdf parse failed; skipping attachment text", String(e));
        }
      } catch (e) {
        console.warn("[intake] attachment read failed", String(e));
      }
    }

    if (info.attachmentStorageIds.length) {
      await ctx.runMutation(internal.intakeQueries.noteAttachments, { messageId, count: info.attachmentStorageIds.length, textChars: attachmentText.length });
    }
    const fullText = `${info.subject}\n${info.body}\n${attachmentText}`;
    let extraction: Extraction;
    if (mode === "claude" && process.env.ANTHROPIC_API_KEY) {
      try {
        extraction = await extractWithClaude({ subject: info.subject, body: info.body, attachmentText, pdfs, currentRouting: info.currentRouting, currentLast4: info.currentLast4, vendorName: info.vendorName });
      } catch (e) {
        console.warn("[intake] claude extractor failed; falling back to rules", String(e));
        extraction = extractWithRules(fullText, { currentRouting: info.currentRouting, currentLast4: info.currentLast4 });
      }
    } else {
      if (mode === "claude") console.warn("[intake] extractorMode=claude but ANTHROPIC_API_KEY unset; using rules");
      extraction = extractWithRules(fullText, { currentRouting: info.currentRouting, currentLast4: info.currentLast4 });
    }
    // Rules always run for the receipt-claim regex even in Claude mode.
    const rules = extractWithRules(fullText, { currentRouting: info.currentRouting, currentLast4: info.currentLast4 });
    const receiptClaimCents = extraction.receiptClaimCents ?? rules.receiptClaimCents;

    const result: Record<string, unknown> = {
      changed: extraction.changed,
      contactAlsoChanged: extraction.contactAlsoChanged,
      evidence: extraction.evidence,
      confidence: extraction.confidence,
      mode: extraction.mode,
      newRoutingMasked: extraction.newRouting ?? null,
      newAccountLast4: extraction.newAccountNumber ? extraction.newAccountNumber.slice(-4) : null,
      receiptClaim: receiptClaimCents !== undefined,
    };

    if (extraction.changed && extraction.newRouting && extraction.newAccountNumber) {
      let vendorId = info.vendorId;
      let senderMismatch = false;
      if (!vendorId) {
        // Unknown sender domain: who does the message claim to be? (homoglyph / subdomain / display-name spoof)
        const claimed = await ctx.runQuery(internal.intakeQueries.resolveClaimedVendor, { from: info.from, subject: info.subject, body: info.body });
        if (claimed) {
          vendorId = claimed.vendorId;
          senderMismatch = true;
          result.claimedVendor = claimed.vendorName;
          result.senderMismatch = claimed.reason;
          await ctx.runMutation(internal.intakeQueries.noteSenderMismatch, { messageId, vendorId, from: info.from, reason: claimed.reason, realDomain: claimed.realDomain, senderDomain: claimed.senderDomain });
        }
      }
      if (!vendorId) {
        // Unknown sender and no vendor claimed. We cannot bind the account to a vendor we know; nothing can be paid to it.
        result.outcome = "unknown_vendor_held";
        await ctx.runMutation(internal.intakeQueries.noteUnknownVendor, { messageId, from: info.from, evidence: extraction.evidence });
      } else {
        const created = await ctx.runAction(internal.bankAccounts.createUnverified, {
          vendorId,
          routing: extraction.newRouting,
          accountNumberPlain: extraction.newAccountNumber,
          createdVia: "intake",
          triggerMessageId: messageId,
          contactAlsoChanged: extraction.contactAlsoChanged,
        });
        result.caseId = created.caseId;
        result.accountId = created.accountId;
        result.outcome = created.reused ? "existing_case" : "case_opened";
        if (senderMismatch && created.caseId) {
          await ctx.runMutation(internal.intakeQueries.flagCaseSenderMismatch, { caseId: created.caseId, messageId, from: info.from });
        }
        if (extraction.contactAlsoChanged && extraction.newContactValue) {
          await ctx.runMutation(internal.contacts.addUntrustedContact, { vendorId, kind: "phone", value: extraction.newContactValue, messageId, caseId: created.caseId ?? undefined });
        }
      }
    } else if (receiptClaimCents !== undefined && info.openCaseId) {
      await ctx.runMutation(internal.messages.recordReceiptClaim, { messageId, caseId: info.openCaseId, statedAmountCents: receiptClaimCents });
      result.outcome = "receipt_claim_ignored";
    } else {
      result.outcome = "no_change";
    }

    // Invoice carried by the message: if the remit account is not verified, a case already exists by construction.
    if (info.invoice && (info.vendorId || (result.outcome === "case_opened" || result.outcome === "existing_case"))) {
      const vid = info.vendorId ?? (await ctx.runQuery(internal.intakeQueries.resolveClaimedVendor, { from: info.from, subject: info.subject, body: info.body }))?.vendorId;
      if (vid) await ctx.runMutation(internal.intakeQueries.attachInvoice, { messageId, vendorId: vid, invoice: info.invoice, accountId: (result.accountId as never) ?? undefined });
    }

    await ctx.runMutation(internal.messages.setIntakeResult, { messageId, status: "done", result });
  },
});
