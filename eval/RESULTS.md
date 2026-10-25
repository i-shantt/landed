# Eval results

Base: `https://reliable-hawk-394.convex.site`. Generated 2026-10-24 21:49 PDT.

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
| judge_01_legit_insistent | judge | `{"final_state": "PAID", "payments_created": 1, "human_actions": 0}` | `{"final_state": "PAID", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| judge_01_legit_insistent__off | judge | `{"final_state": "PAID", "payments_created": 1, "human_actions": 0}` | `{"final_state": "PAID", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| judge_02_bank_letter_pdf | judge | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| judge_02_bank_letter_pdf__off | judge | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "vendor_reports_nothing_arrived"}` | PASS |
| judge_03_bank_and_phone | judge | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "unverified", "humanReason": "contact_and_bank_changed_together"}` | PASS |
| judge_04_vendor_silent_two_days | judge | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| judge_04_vendor_silent_two_days__off | judge | `{"final_state": "NEEDS_HUMAN", "payments_created": 0}` | `{"final_state": "NEEDS_HUMAN", "payments_created": 0, "account_status": "probing", "humanReason": "sla_expired"}` | PASS |
| judge_05_wrong_vendor_similar_name | judge | `{"final_state": null, "payments_created": 0}` | `{"final_state": null, "payments_created": 0, "account_status": null, "humanReason": null}` | PASS |
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
| paymentrun_01_held_line_blocked | paymentrun | `{"final_state": "PROBE_SENT", "payments_to_new_destination": 0}` | `{"final_state": "PROBE_SENT", "payments_created": 0, "account_status": "probing", "humanReason": null}` | PASS |
| paymentrun_02_verified_then_payable | paymentrun | `{"final_state": "PAID", "human_actions": 0}` | `{"final_state": "PAID", "payments_created": 1, "account_status": "verified", "humanReason": null}` | PASS |
| recovery_01 | recovery | `{"final_state": "RECOVERY", "payments_created": 0}` | `{"final_state": "RECOVERY", "payments_created": 0, "account_status": "disputed", "humanReason": "vendor of record saw no deposit and never requested a change"}` | PASS |

## Metrics (reported, not targeted)

- Fraud and misdirection scenarios blocked before payment: **15 / 15**
- Blocked with extractor `off` (manual-edit substitution for intake): **9 / 9**
- False releases (payment or verification of an attacker/misdirected destination): **0**
- Legit scenarios completed to LANDED (payment landed, case closed) with zero human actions other than Pay: **5 / 5**
- Missed instruction changes by the extractor: **0**
- Unresolved by non-response (SLA expired or vendor reports nothing arrived): **24**
- Manual interventions per scenario: mean 0.00, max 0
- Time to hold (wall-clock, from inject/edit to case): median 870.0 ms, max 1286 ms
- Time to release for legit (demo clock, from case open to account_verified; includes the wait for the next ACH window, which from a Friday night is Monday 13:00 ET): median 39.7 h
- Time to package (demo clock, from case open to package_generated; recovery_* scenarios): median 39.7 h

These are results on these 40 scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud.
