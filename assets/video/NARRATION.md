# NARRATION.md — voice-over for assets/video/landed-raw.webm (target 2:30, first 15 s is the moment)

Timestamps follow the marks printed by `web/scripts/record-demo.mjs` (re-run it to refresh them; they are listed at the end of this file after each recording).

| Time | Say |
|---|---|
| 0:00 | "This email is authentic. Real vendor domain, DMARC-clean, inside a thread about a real invoice. It says: we switched banks. The money still did not move." |
| 0:08 | "Landed turned the request into a case, pointed the $42,000 invoice at the new account, and blocked it. A randomized test deposit went to the new account." |
| 0:20 | "The attacker, reading the inbox, replied 'we received your deposit.' Email cannot confirm anything, so that line is ignored." |
| 0:30 | "The real vendor, reached on the phone number we verified at onboarding, said nothing arrived. The case went to a human. The clerk's Pay was refused by the database." |
| 0:45 | "Now the hard version: the AI is switched off. A clerk who was fooled types the attacker's account into the vendor record by hand." |
| 0:58 | "Same result. The payment function refuses anything that is not verified for this vendor at this account version. No model gets a vote." |
| 1:10 | "And the honest case: the vendor read the amount back, the account verified, the invoice was paid, the money landed, the case closed. No human step." |
| 1:30 | "What the agent can and cannot call is enforced in the database: it can read, extract, hold and draft. It cannot verify, pay, release, or edit contacts." |
| 1:45 | "What is real: the engine, the invariants, the extractors, the portal, the audit log, the eval. What is simulated: the bank, time, the vendor's answer, and email authentication results. Each simulation is labeled on screen." |
| 2:00 | "Judges can run their own scenario on the Judge page: insistent vendor, bank letter PDF, bank and phone changed together, two days of silence, wrong vendor. Twenty scripted cases, zero false releases." |
| 2:15 | "Landed. No payment to an account the vendor hasn't confirmed." |

## Marks from the last recording

(filled in by the recording run; see BUILD_LOG.md)
