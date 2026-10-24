"use node";
// .eml intake (additive): parse a real email file (headers, body, attachments, Authentication-Results)
// and feed it to the normal intake path. Auth results come from the headers; if absent we say so
// rather than inventing a pass.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import PostalMime from "postal-mime";

export type ParsedAuth = { spf: boolean | null; dkim: boolean | null; dmarc: boolean | null; present: boolean; raw: string | null };

export function parseAuthResults(header: string | null | undefined): ParsedAuth {
  if (!header) return { spf: null, dkim: null, dmarc: null, present: false, raw: null };
  const h = header.toLowerCase();
  const pick = (k: string) => { const m = h.match(new RegExp(`${k}=(pass|fail|softfail|none|neutral|temperror|permerror|policy)`)); return m ? m[1] === "pass" : null; };
  return { spf: pick("spf"), dkim: pick("dkim"), dmarc: pick("dmarc"), present: true, raw: header.slice(0, 500) };
}

export const ingest = action({
  args: { raw: v.string(), vendorId: v.optional(v.id("vendors")), fileName: v.optional(v.string()) },
  handler: async (ctx, { raw, vendorId, fileName }): Promise<{ messageId: Id<"messages">; from: string; subject: string; auth: ParsedAuth; attachments: number; threadId: string | null }> => {
    const mail = await PostalMime.parse(raw);
    const from = mail.from ? (mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address ?? "") : "unknown@unknown";
    const to = mail.to?.map((t) => t.address).filter(Boolean).join(", ") || undefined;
    const subject = mail.subject ?? "(no subject)";
    const body = mail.text ?? (mail.html ? mail.html.replace(/<[^>]+>/g, " ") : "");
    const header = (name: string) => mail.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value ?? null;
    const auth = parseAuthResults(header("authentication-results") ?? header("arc-authentication-results"));
    const inReplyTo = header("in-reply-to"); const refs = header("references");
    const threadId = (refs?.split(/\s+/)[0] ?? inReplyTo ?? null)?.replace(/[<>]/g, "") ?? null;
    const attachmentStorageIds: Id<"_storage">[] = [];
    for (const att of mail.attachments ?? []) {
      if (att.mimeType !== "application/pdf") continue;
      const bytes = typeof att.content === "string" ? Buffer.from(att.content, "base64") : Buffer.from(att.content as ArrayBuffer);
      attachmentStorageIds.push(await ctx.storage.store(new Blob([bytes], { type: "application/pdf" })));
    }
    const messageId = await ctx.runMutation(internal.messages.insertInternal, {
      from, to, subject, body, vendorId,
      threadId: threadId ? `eml-${threadId}` : undefined,
      // Only a present header can assert a pass; missing or non-pass → false, and the UI shows "no authentication results in headers".
      dmarc: auth.dmarc === true, spf: auth.spf === true, dkim: auth.dkim === true,
      attachmentStorageIds: attachmentStorageIds.length ? attachmentStorageIds : undefined,
    });
    await ctx.runMutation(internal.intakeQueries.noteEml, { messageId, fileName: fileName ?? "upload.eml", authPresent: auth.present, raw: auth.raw, replyTo: header("reply-to"), attachments: (mail.attachments ?? []).length });
    void api;
    return { messageId, from, subject, auth, attachments: attachmentStorageIds.length, threadId };
  },
});
