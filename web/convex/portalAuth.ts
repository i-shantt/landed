import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import bcrypt from "bcryptjs";

export const login = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, { username, password }): Promise<{ token: string; vendorId: Id<"vendors"> }> => {
    const hash = await ctx.runMutation(internal.channels.portal.credentialHash, { username: username.trim().toLowerCase() });
    if (!hash) throw new ConvexError("bad_credentials");
    const ok = await bcrypt.compare(password, hash);
    if (!ok) throw new ConvexError("bad_credentials");
    return ctx.runMutation(internal.channels.portal.createSession, { username: username.trim().toLowerCase() });
  },
});
