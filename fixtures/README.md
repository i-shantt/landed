# fixtures

Deterministic seed data for Landed. Regenerate with `python3 fixtures/generate.py` (seeded RNG, no LLM, no network).

- `company.json`: Meridian Outdoor Co., `meridianoutdoor.example`, America/Los_Angeles.
- `vendors.json`: 20 vendors (`.example` domains). Index 0 is the demo vendor **CleanCo Facilities** with an open $42,000 invoice `CC-2026-0412` due in 6 days. Vendors `cleanco`, `bluewatertextiles`, `harborline` have portal logins (username = slug, password `landed-demo`).
- `contacts.json`: one `record` phone per vendor (`+1555010xxxx`, unroutable), a `discovered` email, and a `record` portal contact for portal vendors.
- `bankAccounts.json`: one verified account per vendor; routing numbers pass the ABA checksum; account numbers 8–12 digits. Full account numbers exist only here and are encrypted at seed time.
- `invoices.json` / `payments.json`: 3 months of paid invoices (2–4 per vendor). Payments are history only; seed does not write `payments` rows (payments.send is the only writer).
- `messages.json`: 2–3 messages per invoice thread, DMARC pass.

`web/convex/fixtureData.json` is the combined file bundled into Convex. Timestamps are relative to `generatedAt` and shifted to seed time by `seed.ts`.
