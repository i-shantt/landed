# OPEN_QUESTIONS

Assumptions made and integrations not completed, with the reason.

## Assumptions
- Next.js installed as 16.4.3 (create-next-app@latest), not 15 as the brief assumed. App Router conventions are the same for our purposes; `next/dist/docs` was consulted where behavior differed.
- `availabilityFor` uses the company's timezone (America/Los_Angeles) as the receiver timezone, per the brief's simplification.
- Dev crypto keys: if `ACCOUNT_HMAC_KEY` / `ACCOUNT_ENC_KEY` are unset, deterministic dev keys are derived from a fixed string and a loud warning is logged. Set real keys with `npx convex env set` before any non-demo use.
- Crypto helpers use Web Crypto in the default Convex runtime instead of Node `crypto` under "use node". Same algorithms (HMAC-SHA256, AES-256-GCM, iv|tag|ct layout). Reason: keeps bankAccounts/probes/payments actions out of the Node runtime and testable in convex-test.
- `vendors.slug`, `company.bankRouting`, `company.bankLast4`, `confirmations.mode`, `cases.by_newAccount`, `payments.by_case`, `timers.by_case`, `confirmTokens.by_case`, `invoices.by_number` were added to the schema (additions only).
- Historical payments are not seeded into `payments` so that `payments.send` remains the only writer. Payment history is represented by paid invoices and `firstPaidAt` on accounts.
- A new case is observably `PROBE_SENT` right after it opens (the probe is queued in the same transaction). `HELD` exists in the state machine and the audit log, and is where a case sits if probe creation ever fails.
