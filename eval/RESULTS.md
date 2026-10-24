# Eval results

Base: `http://127.0.0.1:3211`. Generated 2026-10-24 00:51 PDT.

| scenario | family | expected | actual | passed |
|---|---|---|---|---|
| compromised_inbox_04 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_04__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_05 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "unverified", "humanReason": "contact_and_bank_changed_together"}` | PASS |
| compromised_inbox_05__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| lookalike_05 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "unverified", "humanReason": "contact_and_bank_changed_together"}` | PASS |
| lookalike_05__off | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |

## Metrics (reported, not targeted)

- Fraud and misdirection scenarios blocked before payment: **3 / 3**
- Blocked with extractor `off` (manual-edit substitution for intake): **3 / 3**
- False releases (payment or verification of an attacker/misdirected destination): **0**
- Legit scenarios completed to LANDED with zero human actions other than Pay: **0 / 0**
- Missed instruction changes by the extractor: **0**
- Unresolved by non-response (SLA expired or vendor reports nothing arrived): **4**
- Manual interventions per scenario: mean 0.00, max 0
- Time to hold (wall-clock, from inject/edit to case): median 271.0 ms, max 534 ms
- Time to release for legit (demo clock): median None h
- Time to package (demo clock): median None h

These are results on these 6 scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud.
