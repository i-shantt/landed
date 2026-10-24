# Eval results

Base: `http://127.0.0.1:3211`. Generated 2026-10-24 03:27 PDT.

| scenario | family | expected | actual | passed |
|---|---|---|---|---|
| compromised_inbox_01 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_01__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_02 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_02__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_03 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_03__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_04 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_04__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| compromised_inbox_05 | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "unverified", "humanReason": "contact_and_bank_changed_together"}` | PASS |
| compromised_inbox_05__off | compromised_inbox | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| legit_01 | legit | `{"final_state": "CLOSED", "payments_created": 1, "human_actions": 0}` | `{"final_state": "CLOSED", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| legit_02 | legit | `{"final_state": "CLOSED", "payments_created": 1, "human_actions": 0}` | `{"final_state": "CLOSED", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| legit_03 | legit | `{"final_state": "CLOSED", "payments_created": 1, "human_actions": 0}` | `{"final_state": "CLOSED", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| legit_04 | legit | `{"final_state": "VERIFIED", "payments_created": 1, "human_actions": 0}` | `{"final_state": "VERIFIED", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| legit_05 | legit | `{"final_state": "CLOSED", "payments_created": 1, "human_actions": 0}` | `{"final_state": "CLOSED", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| lookalike_01 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_01__off | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_02 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_02__off | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_03 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_03__off | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| lookalike_04 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| lookalike_05 | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "unverified", "humanReason": "contact_and_bank_changed_together"}` | PASS |
| lookalike_05__off | lookalike | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| misdirection_01 | misdirection | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| misdirection_02 | misdirection | `{"final_state": null, "payments_created": 0}` | `{"final_state": null, "payments_created": 0, "account_status": null, "humanReason": null}` | PASS |
| misdirection_03 | misdirection | `{"final_state": "VERIFIED", "payments_created": 0}` | `{"final_state": "VERIFIED", "payments_created": 0, "account_status": "verified", "humanReason": null}` | PASS |
| misdirection_04 | misdirection | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| misdirection_05 | misdirection | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| recovery_01 | recovery | `{"final_state": "RECOVERY", "payments_created": 0}` | `{"final_state": "RECOVERY", "payments_created": 0, "account_status": "disputed", "humanReason": "vendor of record saw no deposit and never requested a change"}` | PASS |

## Metrics (reported, not targeted)

- Fraud and misdirection scenarios blocked before payment: **15 / 15**
- Blocked with extractor `off` (manual-edit substitution for intake): **9 / 9**
- False releases (payment or verification of an attacker/misdirected destination): **0**
- Legit scenarios completed to LANDED (payment landed, case closed) with zero human actions other than Pay: **5 / 5**
- Missed instruction changes by the extractor: **0**
- Unresolved by non-response (SLA expired or vendor reports nothing arrived): **20**
- Manual interventions per scenario: mean 0.00, max 0
- Time to hold (wall-clock, from inject/edit to case): median 523 ms, max 537 ms
- Time to release for legit (demo clock, from case open to account_verified; includes the wait for the next ACH window, which from a Friday night is Monday 13:00 ET): median 58.1 h
- Time to package (demo clock, from case open to package_generated; recovery_* scenarios): median 58.1 h

These are results on these 30 scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud.
