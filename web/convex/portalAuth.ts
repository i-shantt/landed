import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";

export const login = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }): Promise<{ token: string; vendorId: Id<"vendors"> }> => {
    const u = username.trim().toLowerCase();
    const lockedMs = await ctx.runQuery(internal.portalGuard.check, { username: u });
    if (lockedMs > 0) throw new ConvexError({ code: "locked", retryAfterMs: lockedMs });
    const hash = await ctx.runMutation(internal.channels.portal.credentialHash, { username: u });
    const ok = hash ? await bcrypt.compare(password, hash) : false;
    if (!ok) {
      const f = await ctx.runMutation(internal.portalGuard.recordFailure, { username: u });
      throw new ConvexError(f.lockedUntil ? { code: "locked", retryAfterMs: f.lockedUntil - Date.now() } : { code: "bad_credentials", failsLeft: 5 - f.fails });
    }
    await ctx.runMutation(internal.portalGuard.clear, { username: u });
    return ctx.runMutation(internal.channels.portal.createSession, { username: u });
  },
});
