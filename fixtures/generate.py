#!/usr/bin/env python3
"""Deterministic fixture generator for Landed. Seeded RNG, no LLM, no network.

Writes fixtures/*.json (one file per table) and web/convex/fixtureData.json (combined,
bundled into the Convex deployment and loaded by seed.ts). All timestamps are absolute
ms relative to `generatedAt`; seed.ts shifts them so "now" lines up at seed time.
"""
import json, random, re, os
from datetime import datetime, timedelta, timezone

SEED = 1300
rng = random.Random(SEED)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_WEB = os.path.join(HERE, "..", "web", "convex", "fixtureData.json")

DAY = 86_400_000
NOW = datetime(2026, 10, 24, 7, 0, 0, tzinfo=timezone.utc)
now_ms = int(NOW.timestamp() * 1000)

def ms(days_ago: float, hour: int = 17) -> int:
    d = NOW - timedelta(days=days_ago)
    d = d.replace(hour=hour, minute=rng.randrange(0, 60), second=0, microsecond=0)
    return int(d.timestamp() * 1000)

def aba_ok(r: str) -> bool:
    d = [int(c) for c in r]
    return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 == 0

def make_routing() -> str:
    # Fed prefixes 01-12, 21-32 then random body, then fix the check digit.
    while True:
        prefix = rng.choice([f"{i:02d}" for i in list(range(1, 13)) + list(range(21, 33))])
        body = prefix + "".join(str(rng.randrange(10)) for _ in range(6))
        for check in range(10):
            r = body + str(check)
            if aba_ok(r):
                return r

def make_account(n: int | None = None) -> str:
    n = n or rng.randrange(8, 13)
    return str(rng.randrange(1, 10)) + "".join(str(rng.randrange(10)) for _ in range(n - 1))

def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower().split(" ")[0])

company = {
    "name": "Meridian Outdoor Co.",
    "domain": "meridianoutdoor.example",
    "timezone": "America/Los_Angeles",
    "bankRouting": "121000358",
    "bankLast4": "0001",
}

VENDOR_NAMES = [
    ("CleanCo Facilities", "cleanco.example"),                 # index 0: demo vendor
    ("NorthPeak Logistics", "northpeak.example"),
    ("Granite Ridge Packaging", "graniteridge.example"),
    ("Bluewater Textiles", "bluewatertextiles.example"),
    ("Summit Print Works", "summitprint.example"),
    ("Riverbend IT Services", "riverbendit.example"),
    ("Alder & Finch Legal", "alderfinch.example"),
    ("Cascade Fleet Maintenance", "cascadefleet.example"),
    ("Pinecrest Staffing", "pinecreststaffing.example"),
    ("Harborline Freight", "harborline.example"),
    ("Timberline Displays", "timberlinedisplays.example"),
    ("Westfork Security", "westforksecurity.example"),
    ("Juniper Creative Studio", "junipercreative.example"),
    ("Redstone Metal Fabrication", "redstonemetal.example"),
    ("Lakeview Catering", "lakeviewcatering.example"),
    ("Sierra Uniform Supply", "sierrauniform.example"),
    ("Ironwood Tooling", "ironwoodtooling.example"),
    ("Clearwater Janitorial", "clearwaterjan.example"),
    ("Basecamp Analytics", "basecampanalytics.example"),
    ("Trailhead Media", "trailheadmedia.example"),
]
PORTAL_VENDORS = {0, 3, 9}  # cleanco, bluewater, harborline

vendors, contacts, bank_accounts, invoices, payments, messages, creds = [], [], [], [], [], [], []
used_routings = set()

for i, (name, domain) in enumerate(VENDOR_NAMES):
    slug = slugify(name) if i else "cleanco"
    slug = {"alder": "alderfinch", "granite": "graniteridge", "summit": "summitprint", "riverbend": "riverbendit",
            "cascade": "cascadefleet", "pinecrest": "pinecreststaffing", "timberline": "timberlinedisplays",
            "westfork": "westforksecurity", "juniper": "junipercreative", "redstone": "redstonemetal",
            "lakeview": "lakeviewcatering", "sierra": "sierrauniform", "ironwood": "ironwoodtooling",
            "clearwater": "clearwaterjan", "basecamp": "basecampanalytics", "trailhead": "trailheadmedia",
            "bluewater": "bluewatertextiles"}.get(slug, slug)
    onboarded = ms(rng.randrange(200, 900))
    vendor = {"slug": slug, "name": name, "domain": domain, "onboardedAt": onboarded, "hasPortalLogin": i in PORTAL_VENDORS}
    if i == 0:
        vendor["notes"] = "Demo vendor: open $42,000 invoice due in 6 days."
    vendors.append(vendor)
    phone = f"+1555010{i:04d}"
    contacts.append({"vendorSlug": slug, "kind": "phone", "value": phone, "trustLevel": "record",
                     "establishedAt": onboarded, "establishedVia": "onboarding_form_and_verified_call"})
    contacts.append({"vendorSlug": slug, "kind": "email", "value": f"ap@{domain}", "trustLevel": "discovered",
                     "establishedAt": onboarded, "establishedVia": "onboarding_form"})
    if i in PORTAL_VENDORS:
        contacts.append({"vendorSlug": slug, "kind": "portal", "value": slug, "trustLevel": "record",
                         "establishedAt": onboarded, "establishedVia": "onboarding_form_and_verified_call"})
        creds.append({"vendorSlug": slug, "username": slug, "password": "landed-demo"})
    routing = make_routing()
    while routing in used_routings:
        routing = make_routing()
    used_routings.add(routing)
    first_paid = ms(rng.randrange(95, 180))
    acct_key = f"{slug}_main"
    bank_accounts.append({"vendorSlug": slug, "key": acct_key, "routing": routing, "accountNumber": make_account(),
                          "status": "verified", "firstPaidAt": first_paid})

    # 3 months of invoices (2-4), all paid except the demo vendor's open one
    n_inv = rng.randrange(2, 5)
    prefix = "".join(w[0] for w in name.split()[:2]).upper()
    for k in range(n_inv):
        days_ago = max(12, 85 - k * (85 // n_inv) - rng.randrange(0, 8))  # never in the future relative to seed time
        amount = rng.randrange(180_000, 3_600_000) // 100 * 100
        number = f"{prefix}-2026-{(i * 10 + k + 100):04d}"
        issued = ms(days_ago)
        due = issued + 30 * DAY
        paid_at = min(issued + rng.randrange(12, 28) * DAY, now_ms - 2 * DAY)  # history never post-dates the seed
        invoices.append({"vendorSlug": slug, "number": number, "amountCents": amount, "issuedAt": issued, "dueAt": due,
                         "remitAccountKey": acct_key, "status": "paid"})
        payments.append({"invoiceNumber": number, "sentAt": paid_at, "rail": "ach", "railRef": f"ACH-{rng.randrange(10**9, 10**10)}"})
        thread = f"{slug}-{number}"
        messages.append({"vendorSlug": slug, "threadId": thread, "from": f"ap@{domain}", "to": f"ap@{company['domain']}",
                         "subject": f"Invoice {number}", "body": f"Hello,\n\nPlease find invoice {number} for ${amount/100:,.2f}, due {datetime.fromtimestamp(due/1000, tz=timezone.utc):%B %d}. Remit to our account on file.\n\nThank you,\nAccounts Receivable, {name}",
                         "sentAt": issued, "dmarc": True})
        messages.append({"vendorSlug": slug, "threadId": thread, "from": f"ap@{company['domain']}", "to": f"ap@{domain}",
                         "subject": f"Re: Invoice {number}", "body": f"Received, thanks. Scheduled for payment on our next run.\n\nAP, {company['name']}",
                         "sentAt": min(issued + rng.randrange(1, 3) * DAY, now_ms - 2 * DAY), "dmarc": True})
        if rng.random() < 0.5:
            messages.append({"vendorSlug": slug, "threadId": thread, "from": f"ap@{company['domain']}", "to": f"ap@{domain}",
                             "subject": f"Re: Invoice {number}", "body": f"Payment for {number} was sent by ACH today. Trace {payments[-1]['railRef']}.",
                             "sentAt": paid_at, "dmarc": True})
    if i == 0:
        # the demo invoice: open, $42,000, due in 6 days
        number = "CC-2026-0412"
        issued = ms(8)
        invoices.append({"vendorSlug": slug, "number": number, "amountCents": 4_200_000, "issuedAt": issued, "dueAt": now_ms + 6 * DAY,
                         "remitAccountKey": acct_key, "status": "open"})
        thread = f"{slug}-{number}"
        messages.append({"vendorSlug": slug, "threadId": thread, "from": f"ap@{domain}", "to": f"ap@{company['domain']}",
                         "subject": f"Invoice {number} - October facilities services", "body": f"Hello,\n\nAttached is invoice {number} for $42,000.00 covering October facilities services across the three Meridian sites. Due in 14 days. Remit to our account on file.\n\nThanks,\nDana Whitfield\nAccounts Receivable, CleanCo Facilities",
                         "sentAt": issued, "dmarc": True})
        messages.append({"vendorSlug": slug, "threadId": thread, "from": f"ap@{company['domain']}", "to": f"ap@{domain}",
                         "subject": f"Re: Invoice {number} - October facilities services", "body": "Thanks Dana, received and approved. It is in the queue for our payment run.\n\nMarisol, AP",
                         "sentAt": issued + 1 * DAY, "dmarc": True})

# Optional realism pass: fixtures/thread_bodies.json (from enrich_threads.py) replaces message bodies by index.
# Deterministic bodies remain the fallback; ids, amounts, dates and accounts never change.
_bodies_path = os.path.join(HERE, "thread_bodies.json")
if os.path.exists(_bodies_path):
    _bodies = json.load(open(_bodies_path))
    _applied = 0
    for _i, _m in enumerate(messages):
        if str(_i) in _bodies:
            _m["body"] = _bodies[str(_i)]; _applied += 1
    print(f"applied {_applied} enriched thread bodies")

fixture = {
    "generatedAt": now_ms,
    "company": company,
    "vendors": vendors,
    "contacts": contacts,
    "bankAccounts": bank_accounts,
    "invoices": invoices,
    "payments": payments,
    "messages": messages,
    "portalCredentials": creds,
}

for key in ["company", "vendors", "contacts", "bankAccounts", "invoices", "payments", "messages", "portalCredentials"]:
    with open(os.path.join(HERE, f"{key}.json"), "w") as f:
        json.dump(fixture[key], f, indent=2)
with open(OUT_WEB, "w") as f:
    json.dump(fixture, f, separators=(",", ":"))

assert all(aba_ok(a["routing"]) for a in bank_accounts)
print(f"vendors={len(vendors)} contacts={len(contacts)} accounts={len(bank_accounts)} invoices={len(invoices)} payments={len(payments)} messages={len(messages)} creds={len(creds)}")
print(f"wrote {OUT_WEB} ({os.path.getsize(OUT_WEB)} bytes)")
