# OPEN_QUESTIONS

Assumptions made and integrations not completed, with the reason.

## Assumptions
- Next.js installed as 16.4.3 (create-next-app@latest), not 15 as the brief assumed. App Router conventions are the same for our purposes; `next/dist/docs` was consulted where behavior differed.
- `availabilityFor` uses the company's timezone (America/Los_Angeles) as the receiver timezone, per the brief's simplification.
- Dev crypto keys: if `ACCOUNT_HMAC_KEY` / `ACCOUNT_ENC_KEY` are unset, deterministic dev keys are derived from a fixed string and a loud warning is logged. Set real keys with `npx convex env set` before any non-demo use.
