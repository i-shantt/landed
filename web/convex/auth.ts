// Convex Auth: email + password, self-hosted. Who may sign up is decided by `operators` (see authCallbacks.ts).
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { onUserCreatedOrUpdated, assertCanStartSession } from "./authCallbacks";

export const MIN_PASSWORD_LENGTH = 12;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const name = String(params.name ?? "").trim();
        return name ? { email, name } : { email };
      },
      validatePasswordRequirements(password) {
        if (password.length < MIN_PASSWORD_LENGTH) throw new ConvexError("password_too_short");
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId, profile }) {
      await onUserCreatedOrUpdated(ctx as unknown as MutationCtx, { userId: userId as Id<"users">, existingUserId: existingUserId as Id<"users"> | null, profile: profile as { email?: string; name?: string } });
    },
    async beforeSessionCreation(ctx, { userId }) {
      await assertCanStartSession(ctx as unknown as MutationCtx, userId as Id<"users">);
    },
  },
});
