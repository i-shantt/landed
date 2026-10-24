#!/usr/bin/env python3
"""Optional realism pass (Phase G item 5): rewrite the historical thread bodies with Claude so each vendor
has a distinct voice and realistic invoice chatter. Ids, numbers, amounts, dates, accounts and senders are
NOT changed: every rewritten body must still contain the invoice number and the amount, or the deterministic
body is kept. Output: fixtures/thread_bodies.json, consumed by generate.py when present.

Usage: python3 fixtures/enrich_threads.py   (reads ANTHROPIC_API_KEY from web/.env.local; no key → exits 0)
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
env = {}
try:
    for line in open(os.path.join(HERE, "..", "web", ".env.local")):
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1); env[k.strip()] = v.strip()
except FileNotFoundError:
    pass
key = env.get("ANTHROPIC_API_KEY")
if not key:
    print("[enrich] no ANTHROPIC_API_KEY; keeping deterministic bodies"); sys.exit(0)
try:
    from anthropic import Anthropic
except ImportError:
    print("[enrich] anthropic SDK not installed; keeping deterministic bodies"); sys.exit(0)

messages = json.load(open(os.path.join(HERE, "messages.json")))
vendors = {v["slug"]: v for v in json.load(open(os.path.join(HERE, "vendors.json")))}
client = Anthropic(api_key=key)
model = env.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
out = {}
by_vendor = {}
for i, m in enumerate(messages):
    by_vendor.setdefault(m.get("vendorSlug"), []).append((i, m))

def facts(m):
    inv = re.search(r"\b([A-Z]{2}&?-2026-\d{4})\b", m["subject"] + " " + m["body"])
    amt = re.search(r"\$[\d,]+\.\d{2}", m["body"])
    trace = re.search(r"Trace (ACH-\d+)", m["body"])
    return (inv.group(1) if inv else None), (amt.group(0) if amt else None), (trace.group(1) if trace else None)

for slug, items in by_vendor.items():
    if not slug or slug == "cleanco":
        continue  # the demo vendor's thread is hand-written; leave it
    v = vendors[slug]
    rows = []
    for i, m in items:
        inv, amt, trace = facts(m)
        rows.append({"index": i, "from": m["from"], "subject": m["subject"], "invoice": inv, "amount": amt, "trace": trace, "current": m["body"]})
    prompt = (
        f"Vendor: {v['name']} ({v['domain']}), a small supplier to Meridian Outdoor Co. Give this vendor one consistent voice "
        f"(pick a plausible AR contact name and sign-off; keep it) and rewrite each email body below so the thread reads like real "
        f"invoice chatter between a small vendor and a customer's accounts payable team. Rules: keep every invoice number, dollar amount, "
        f"and ACH trace exactly as given; messages from ap@meridianoutdoor.example are the customer's AP team (sign as Marisol, AP); "
        f"no bank or remittance changes anywhere; no new numbers; 2 to 5 short lines each; plain text. "
        f"Return JSON only: {{\"bodies\": [{{\"index\": <index>, \"body\": \"...\"}}, ...]}} with one entry per input.\n\n" + json.dumps(rows, indent=1)
    )
    try:
        res = client.messages.create(model=model, max_tokens=6000, output_config={"effort": "low"}, messages=[{"role": "user", "content": prompt}])
        text = "".join(b.text for b in res.content if b.type == "text")
        data = json.loads(text[text.index("{"): text.rindex("}") + 1])
        kept = 0
        for entry in data.get("bodies", []):
            idx = entry.get("index"); body = entry.get("body", "")
            row = next((r for r in rows if r["index"] == idx), None)
            if row is None or not body.strip():
                continue
            ok = (not row["invoice"] or row["invoice"] in body) and (not row["amount"] or row["amount"] in body) and (not row["trace"] or row["trace"] in body)
            ok = ok and not re.search(r"\b\d{9}\b", body) and not re.search(r"(?i)routing|remit to|new account|bank details", body)
            if ok:
                out[str(idx)] = body.strip(); kept += 1
        print(f"[enrich] {slug}: {kept}/{len(rows)} bodies accepted")
    except Exception as e:
        print(f"[enrich] {slug}: skipped ({str(e)[:80]})")

json.dump(out, open(os.path.join(HERE, "thread_bodies.json"), "w"), indent=1)
print(f"[enrich] wrote thread_bodies.json with {len(out)} bodies")
