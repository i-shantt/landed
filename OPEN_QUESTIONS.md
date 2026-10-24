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
- `payments.send` returns `{ok:false, code:"payment_refused", reason}` instead of throwing a ConvexError. Reason: a throw inside a Convex mutation rolls the transaction back, which erased the `payment_refused` audit event. The reason is still machine-readable and the UI shows it in red; `/eval/pay` returns the same object.
- Legit cases end in `CLOSED` (via `LANDED`), per the state table `LANDED -> CLOSED` and section 6.8 ("case LANDED then CLOSED"). The eval expects `CLOSED` and checks for the `case_landed` event.
- A bank-change request re-points the vendor's open invoices to the requested account and marks them `held` until the account is verified (or the change is rejected). This is what makes "Pay" on the demo invoice hit `destination_not_verified` rather than paying the old account. `cases.rejectChange` (human) restores them.
- misdirection_02 (wrong template) and misdirection_03 (stale account) do not end in NEEDS_HUMAN: there is no case to escalate (02) or the case is the legitimately VERIFIED one (03). Both end with the payment refused (`destination_vendor_mismatch`, `destination_superseded`) and zero payments; the scenario expectations say so explicitly.
- Browser click-through was not possible unattended: the Chrome tool needs a human to pick one of two connected browsers. Pages were verified by `next build`, a dev-server route sweep (HTTP 200, no error markers), and `web/scripts/checkpoint2.mjs`, which drives the same public functions the pages call.
