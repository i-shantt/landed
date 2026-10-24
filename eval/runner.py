#!/usr/bin/env python3
"""Landed eval runner.

Runs every scenarios/*.yaml against a Convex deployment's /eval/* HTTP actions,
compares outcomes to `expect`, writes results.json + RESULTS.md, and POSTs the
results to /eval/report so the /eval page can show them.

Usage: python runner.py --base http://127.0.0.1:3211 --key dev [--only id] [--skip-off]
"""
from __future__ import annotations
import argparse, glob, json, os, statistics, sys, time
from pathlib import Path
import httpx, yaml

HERE = Path(__file__).parent
HOUR = 3_600_000

class EvalError(Exception):
    pass

class Client:
    def __init__(self, base: str, key: str):
        self.base = base.rstrip("/")
        self.h = httpx.Client(base_url=self.base, headers={"x-eval-key": key, "content-type": "application/json"}, timeout=120)
    def post(self, path, body=None):
        r = self.h.post(path, json=body or {})
        if r.status_code >= 400:
            raise EvalError(f"POST {path} -> {r.status_code} {r.text[:300]}")
        return r.json()
    def get(self, path):
        r = self.h.get(path)
        if r.status_code >= 400:
            raise EvalError(f"GET {path} -> {r.status_code} {r.text[:300]}")
        return r.json()

HUMAN_ACTIONS = {"exceptional_release", "human_review_requested", "fraud_reported", "change_rejected"}

class Scenario:
    def __init__(self, c: Client, spec: dict, extractor_off: bool):
        self.c = c
        self.spec = spec
        self.id = spec["id"] + ("__off" if extractor_off else "")
        self.extractor_off = extractor_off
        self.vendor_slug = spec.get("vendor", "cleanco")
        self.vendor = None
        self.case_id = None
        self.extra_vendor = None
        self.log: list[str] = []
        self.failures: list[str] = []
        self.started = time.time()
        self.hold_ms = None
        self.inject_wall = None
        self.portal_session = None

    # ---- helpers
    def note(self, s):  # noqa
        self.log.append(s)

    def resolve_vendor(self, slug=None):
        slug = slug or self.vendor_slug
        v = self.c.get(f"/eval/vendor/slug/{slug}")
        return v

    def refresh_case(self):
        if not self.case_id:
            return None
        return self.c.get(f"/eval/case/{self.case_id}")

    def latest_case_for_vendor(self, vendor_id=None):
        v = self.c.get(f"/eval/vendor/{vendor_id or self.vendor['vendor']['_id']}")
        cases = [x for x in v["cases"] if x["state"] != "CLOSED"] or v["cases"]
        return cases[0]["_id"] if cases else None

    def wait_intake(self, message_id, timeout=90):
        t0 = time.time()
        while time.time() - t0 < timeout:
            m = self.c.get(f"/eval/message/{message_id}")
            if m["intakeStatus"] != "pending":
                return m
            time.sleep(0.5)
        raise EvalError("intake did not finish")

    def wait_quiet(self, seconds=1.5):
        time.sleep(seconds)

    def open_invoice_id(self, ref):
        if ref in ("cleanco_open", "open", "vendor_open"):
            v = self.c.get(f"/eval/vendor/{self.vendor['vendor']['_id']}")
            inv = [i for i in v["invoices"] if i["status"] in ("open", "held")]
            inv.sort(key=lambda i: i["dueAt"])
            if not inv:
                raise EvalError("no open invoice for vendor")
            return inv[0]["_id"]
        if ref == "crafted":
            return self.crafted_invoice
        if ref == "new_vendor_open":
            return self.extra_vendor["invoiceId"]
        inv = self.c.get(f"/eval/invoice/{ref}")
        return inv["_id"]

    def probe_amount(self):
        return self.c.get(f"/eval/probeAmount/{self.case_id}")["amountCents"]

    # ---- steps
    def step_inject(self, a):
        if self.extractor_off:
            acct = a.get("account")
            if a.get("skip_when_off"):
                self.note("inject skipped (extractor off)")
                return
            if acct:
                return self.step_manual_edit({"routing": acct["routing"], "accountNumber": acct["accountNumber"], "vendor": a.get("vendor")})
            self.note("inject without account skipped (extractor off)")
            return
        body = {"from": a["from"], "subject": a.get("subject", ""), "body": a["body"], "dmarc": a.get("dmarc", True)}
        if a.get("attachmentText"):
            body["attachmentText"] = a["attachmentText"]
        if a.get("attachmentPdf"):
            import base64
            body["attachmentPdfBase64"] = base64.b64encode((HERE / ".." / "fixtures" / a["attachmentPdf"]).read_bytes()).decode()
        if a.get("invoice"):
            body["invoice"] = a["invoice"]
        t0 = time.time()
        r = self.c.post("/eval/inject", body)
        m = self.wait_intake(r["messageId"])
        res = m.get("intakeResult") or {}
        self.note(f"inject -> {res.get('outcome')} mode={res.get('mode')} changed={res.get('changed')}")
        if res.get("caseId"):
            if self.case_id is None:
                self.hold_ms = int((time.time() - t0) * 1000)
            self.case_id = res["caseId"]
        elif self.case_id is None:
            cid = self.latest_case_for_vendor()
            if cid:
                self.case_id = cid
                self.hold_ms = int((time.time() - t0) * 1000)
        self.wait_quiet()

    def step_manual_edit(self, a):
        vendor = self.vendor if not a.get("vendor") else self.resolve_vendor(a["vendor"])
        replaces = None
        if a.get("replaces", "current") == "current":
            cur = [x for x in vendor["accounts"] if x["status"] == "verified"]
            replaces = cur[0]["_id"] if cur else None
        t0 = time.time()
        r = self.c.post("/eval/manualEdit", {"vendorId": vendor["vendor"]["_id"], "routing": a["routing"], "accountNumber": a["accountNumber"], "replacesAccountId": replaces})
        if not r.get("ok"):
            raise EvalError(f"manualEdit failed: {r}")
        if self.case_id is None:
            self.hold_ms = int((time.time() - t0) * 1000)
        self.case_id = r["caseId"]
        self.note(f"manual_edit -> case {self.case_id} reused={r.get('reused')}")
        self.wait_quiet()

    def step_expect_case(self, a):
        c = self.refresh_case()
        if c is None:
            if a.get("state") in (None, "none"):
                return
            self.failures.append(f"expect_case {a}: no case")
            return
        state = c["case"]["state"]
        want = a.get("state")
        if want and state != want:
            self.failures.append(f"expect_case state={want} got={state} (reason={c['case'].get('humanReason')})")
        if "humanReason" in a and c["case"].get("humanReason") != a["humanReason"]:
            self.failures.append(f"expect_case humanReason={a['humanReason']} got={c['case'].get('humanReason')}")
        if "accountStatus" in a and c["newAccount"]["status"] != a["accountStatus"]:
            self.failures.append(f"expect_case accountStatus={a['accountStatus']} got={c['newAccount']['status']}")

    def step_advance_to(self, a):
        kind = a if isinstance(a, str) else a["timer"]
        kind_map = {"settle": "probe_settle", "availability": "probe_available", "sla": "confirmation_sla", "landing_check": "landing_check", "landing_deadline": "landing_deadline"}
        want = kind_map.get(kind, kind)
        c = self.refresh_case()
        if not c:
            raise EvalError("advance_to without a case")
        pend = [t for t in c["timers"] if t["kind"] == want and not t["fired"]]
        if not pend:
            self.failures.append(f"advance_to {kind}: no pending timer")
            return
        self.c.post("/eval/advanceTo", {"at": pend[0]["dueAt"] + 1000})
        self.wait_quiet(2.5)
        self.note(f"advance_to {kind}")

    def step_advance(self, a):
        ms = int(a.get("hours", 0) * HOUR + a.get("days", 0) * 24 * HOUR)
        self.c.post("/eval/advance", {"ms": ms})
        self.wait_quiet(2.0)

    def step_vendor_statement(self, a):
        if isinstance(a, dict):
            kind = a.get("value")
        else:
            kind = a
        body = {"caseId": self.case_id}
        if kind == "correct":
            body["statedAmountCents"] = self.probe_amount()
        elif kind == "wrong":
            amt = self.probe_amount()
            body["statedAmountCents"] = 11 if amt == 99 else amt + 1
        elif kind in ("nothing", None):
            body["statedAmountCents"] = None
            body["outcome"] = "nothing_arrived"
        elif kind in ("voicemail", "no_answer"):
            body["statedAmountCents"] = None
            body["outcome"] = "no_answer"
        else:
            body["statedAmountCents"] = int(kind)
        r = self.c.post("/eval/vendorStatement", body)
        self.note(f"vendor_statement {kind} -> {r}")
        self.wait_quiet()

    def step_landing_statement(self, a):
        kind = a if isinstance(a, str) else a.get("value")
        c = self.refresh_case()
        pay = c["payments"][0] if c and c["payments"] else None
        body = {"caseId": self.case_id, "mode": "landing"}
        if kind == "correct" and pay:
            body["statedAmountCents"] = pay["amountCents"]
        else:
            body["statedAmountCents"] = None
            body["outcome"] = "nothing_arrived"
        r = self.c.post("/eval/vendorStatement", body)
        self.note(f"landing_statement {kind} -> {r}")
        self.wait_quiet()

    def step_expect_confirmation(self, a):
        c = self.refresh_case()
        confs = [x for x in (c["confirmations"] if c else []) if x["channel"] == a["channel"]]
        if not confs:
            self.failures.append(f"expect_confirmation {a}: none with channel {a['channel']}")
            return
        last = confs[-1]
        if "accepted" in a and last["accepted"] != a["accepted"]:
            self.failures.append(f"expect_confirmation accepted={a['accepted']} got={last['accepted']} reason={last['rejectReason']}")

    def step_pay(self, a):
        inv = self.open_invoice_id(a.get("invoice", "cleanco_open"))
        r = self.c.post("/eval/pay", {"invoiceId": inv, "initiatedBy": "eval-clerk", "rail": a.get("rail", "ach")})
        self.last_pay = r
        self.note(f"pay -> {r}")
        self.wait_quiet()

    def step_expect_pay(self, a):
        r = getattr(self, "last_pay", None)
        if r is None:
            self.failures.append("expect_pay without pay")
            return
        if r.get("ok") != a["ok"]:
            self.failures.append(f"expect_pay ok={a['ok']} got={r}")
        if "reason" in a and r.get("reason") != a["reason"]:
            self.failures.append(f"expect_pay reason={a['reason']} got={r.get('reason')}")

    def step_craft_invoice(self, a):
        vendor = self.resolve_vendor(a.get("vendor", self.vendor_slug))
        remit_vendor = self.resolve_vendor(a["remit_vendor"]) if a.get("remit_vendor") else vendor
        if a.get("remit") == "old":
            accts = [x for x in remit_vendor["accounts"] if x["status"] == "superseded"]
        else:
            accts = [x for x in remit_vendor["accounts"] if x["status"] == "verified"]
        if not accts:
            raise EvalError("craft_invoice: no matching account")
        r = self.c.post("/eval/craftInvoice", {"vendorId": vendor["vendor"]["_id"], "remitAccountId": accts[0]["_id"], "number": a.get("number", f"EVAL-{self.id}"), "amountCents": a.get("amountCents", 250000)})
        self.crafted_invoice = r["invoiceId"]
        self.note(f"craft_invoice -> {self.crafted_invoice}")

    def step_create_vendor(self, a):
        r = self.c.post("/eval/createVendor", a)
        self.extra_vendor = r
        self.vendor = self.c.get(f"/eval/vendor/{r['vendorId']}")
        acct = r.get("account") or {}
        if acct.get("caseId"):
            self.case_id = acct["caseId"]
            self.hold_ms = 0
        self.note(f"create_vendor -> {r['vendorId']} case={self.case_id}")
        self.wait_quiet()

    def step_portal_confirm(self, a):
        kind = a if isinstance(a, str) else a.get("value")
        if not self.portal_session:
            login = self.c.post("/eval/portalLogin", {"username": self.vendor_slug, "password": "landed-demo"})
            if not login.get("ok"):
                raise EvalError(f"portal login failed {login}")
            self.portal_session = login["token"]
        reqs = self.c.post("/eval/portalRequests", {"sessionToken": self.portal_session})
        if not reqs.get("requests"):
            self.failures.append("portal_confirm: no open requests in the portal")
            return
        tok = reqs["requests"][0]["token"]
        amt = self.probe_amount() if kind == "correct" else (self.probe_amount() + 1)
        r = self.c.post("/eval/portalConfirm", {"sessionToken": self.portal_session, "token": tok, "statedAmountCents": amt})
        self.note(f"portal_confirm {kind} -> {r}")
        self.wait_quiet()

    def step_set_setting(self, a):
        self.c.post("/eval/setting", a)

    def step_expect_account(self, a):
        c = self.refresh_case()
        if not c:
            self.failures.append("expect_account: no case")
            return
        if c["newAccount"]["status"] != a["status"]:
            self.failures.append(f"expect_account {a['status']} got {c['newAccount']['status']}")

    def step_expect_no_case(self, a):
        cid = self.latest_case_for_vendor()
        if cid and self.case_id is None:
            self.failures.append(f"expect_no_case: found case {cid}")

    # ---- run
    def run(self):
        c = self.c
        c.post("/eval/reset", {"which": "full"})
        c.post("/eval/setting", {"key": "extractorMode", "value": "off" if self.extractor_off else self.spec.get("extractor", "rules")})
        self.vendor = self.resolve_vendor()
        for step in self.spec["steps"]:
            (name, arg), = step.items()
            if self.extractor_off and isinstance(arg, dict) and arg.get("skip_when_off"):
                self.note(f"{name} skipped (extractor off)")
                continue
            fn = getattr(self, f"step_{name}", None)
            if not fn:
                raise EvalError(f"unknown step {name}")
            try:
                fn(arg if arg is not None else {})
            except EvalError as e:
                self.failures.append(f"{name}: {e}")
                break
        return self.finish()

    def finish(self):
        exp = self.spec.get("expect", {})
        case = self.refresh_case()
        overview = self.c.get("/eval/overview")
        actual = {
            "final_state": case["case"]["state"] if case else None,
            "humanReason": case["case"].get("humanReason") if case else None,
            "payments_created": len(overview["payments"]),
            "account_status": case["newAccount"]["status"] if case else None,
        }
        # payments to the disputed/new destination
        if case:
            actual["payments_to_new_destination"] = len([p for p in overview["payments"] if p["destinationAccountId"] == case["case"]["newAccountId"]])
        events = case["events"] if case else []
        human = [e for e in events if e["type"] in HUMAN_ACTIONS]
        actual["human_actions"] = len(human)
        verified = next((e for e in events if e["type"] == "account_verified"), None)
        pkg = next((e for e in events if e["type"] == "package_generated"), None)
        metrics = {
            "time_to_hold_ms": self.hold_ms,
            "time_to_release_demo_ms": (verified["at"] - case["case"]["openedAt"]) if (verified and case) else None,
            "time_to_package_demo_ms": (pkg["at"] - case["case"]["openedAt"]) if (pkg and case) else None,
            "human_actions": len(human),
            "wall_ms": int((time.time() - self.started) * 1000),
            "extractor_off": self.extractor_off,
        }
        for k, v in exp.items():
            if k not in actual:
                continue
            if actual[k] != v:
                self.failures.append(f"expect.{k}={v} got={actual[k]}")
        return {
            "scenarioId": self.id,
            "family": self.spec.get("family"),
            "startedAt": int(self.started * 1000),
            "finishedAt": int(time.time() * 1000),
            "expected": exp,
            "actual": actual,
            "passed": not self.failures,
            "failures": self.failures,
            "metrics": metrics,
            "log": self.log,
        }

def load_scenarios(only=None):
    out = []
    for f in sorted(glob.glob(str(HERE / "scenarios" / "*.yaml"))):
        spec = yaml.safe_load(open(f))
        if only and spec["id"] not in only:
            continue
        out.append(spec)
    return out

def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None

def write_results(results, base):
    (HERE / "results.json").write_text(json.dumps(results, indent=2))
    fraud = [r for r in results if r["family"] in ("compromised_inbox", "lookalike", "misdirection") and not r["metrics"]["extractor_off"]]
    fraud_off = [r for r in results if r["family"] in ("compromised_inbox", "lookalike", "misdirection") and r["metrics"]["extractor_off"]]
    legit = [r for r in results if r["family"] == "legit" and not r["metrics"]["extractor_off"]]
    blocked = [r for r in fraud if r["actual"].get("payments_to_new_destination", 0) == 0 and r["actual"]["payments_created"] == (r["expected"].get("payments_created", 0))]
    blocked_off = [r for r in fraud_off if r["actual"].get("payments_to_new_destination", 0) == 0]
    false_releases = [r for r in fraud + fraud_off if r["actual"].get("payments_to_new_destination", 0) > 0 or (r["actual"].get("account_status") == "verified" and r["actual"].get("final_state") not in (None,) and r["family"] != "legit" and r["expected"].get("final_state") != "VERIFIED")]
    legit_ok = [r for r in legit if r["actual"]["final_state"] == "LANDED" and r["metrics"]["human_actions"] == 0]
    missed = [r for r in fraud if "missed_extraction" in " ".join(r["failures"]) or (r["actual"]["final_state"] is None and r["family"] != "misdirection")]
    nonresponse = [r for r in results if r["actual"].get("humanReason") in ("sla_expired", "vendor_reports_nothing_arrived")]
    interventions = [r["metrics"]["human_actions"] for r in results]
    hold = [r["metrics"]["time_to_hold_ms"] for r in results]
    rel = [r["metrics"]["time_to_release_demo_ms"] for r in legit]
    pkg = [r["metrics"]["time_to_package_demo_ms"] for r in results]
    lines = [
        "# Eval results", "",
        f"Base: `{base}`. Generated {time.strftime('%Y-%m-%d %H:%M %Z')}.", "",
        "| scenario | family | expected | actual | passed |", "|---|---|---|---|---|",
    ]
    for r in results:
        lines.append(f"| {r['scenarioId']} | {r['family']} | `{json.dumps(r['expected'])}` | `{json.dumps({k: r['actual'].get(k) for k in ('final_state','payments_created','account_status','humanReason')})}` | {'PASS' if r['passed'] else 'FAIL: ' + '; '.join(r['failures'])[:200]} |")
    lines += [
        "", "## Metrics (reported, not targeted)", "",
        f"- Fraud and misdirection scenarios blocked before payment: **{len(blocked)} / {len(fraud)}**",
        f"- Blocked with extractor `off` (manual-edit substitution for intake): **{len(blocked_off)} / {len(fraud_off)}**",
        f"- False releases (payment or verification of an attacker/misdirected destination): **{len(false_releases)}**" + (f" -> {[r['scenarioId'] for r in false_releases]}" if false_releases else ""),
        f"- Legit scenarios completed to LANDED with zero human actions other than Pay: **{len(legit_ok)} / {len(legit)}**" + ("" if len(legit_ok) == len(legit) else f" (escalated: {[(r['scenarioId'], r['actual'].get('humanReason')) for r in legit if r not in legit_ok]})"),
        f"- Missed instruction changes by the extractor: **{len(missed)}**" + (f" -> {[r['scenarioId'] for r in missed]}" if missed else ""),
        f"- Unresolved by non-response (SLA expired or vendor reports nothing arrived): **{len(nonresponse)}**",
        f"- Manual interventions per scenario: mean {statistics.mean(interventions):.2f}, max {max(interventions)}" if interventions else "",
        f"- Time to hold (wall-clock, from inject/edit to case): median {med(hold)} ms, max {max([h for h in hold if h is not None], default=None)} ms",
        f"- Time to release for legit (demo clock): median {med(rel) and round(med(rel)/HOUR, 1)} h",
        f"- Time to package (demo clock): median {med(pkg) and round(med(pkg)/HOUR, 1)} h",
        "",
        f"These are results on these {len(results)} scripted cases. They demonstrate behavior on these cases; they do not establish effectiveness against real-world fraud.",
    ]
    (HERE / "RESULTS.md").write_text("\n".join(lines) + "\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("CONVEX_SITE_URL", "http://127.0.0.1:3211"))
    ap.add_argument("--key", default=os.environ.get("EVAL_KEY", "dev"))
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--skip-off", action="store_true", help="skip the extractor-off re-run of fraud scenarios")
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args()
    c = Client(args.base, args.key)
    results = []
    for spec in load_scenarios(args.only):
        for off in ([False, True] if (spec.get("family") != "legit" and not args.skip_off) else [False]):
            if off and not spec.get("off_mode", True):
                continue
            s = Scenario(c, spec, off)
            try:
                r = s.run()
            except Exception as e:  # noqa
                r = {"scenarioId": s.id, "family": spec.get("family"), "startedAt": int(s.started * 1000), "finishedAt": int(time.time() * 1000), "expected": spec.get("expect", {}), "actual": {"error": str(e)}, "passed": False, "failures": [str(e)], "metrics": {"extractor_off": off, "human_actions": 0, "time_to_hold_ms": None, "time_to_release_demo_ms": None, "time_to_package_demo_ms": None}, "log": s.log}
            print(f"{'PASS' if r['passed'] else 'FAIL'} {r['scenarioId']:32s} final={r['actual'].get('final_state')} payments={r['actual'].get('payments_created')} {'; '.join(r['failures'])[:160]}", flush=True)
            results.append(r)
    write_results(results, args.base)
    if not args.no_report:
        rows = [{k: v for k, v in r.items() if k != "log"} for r in results]
        rows.append({"scenarioId": "__metrics__", "startedAt": int(time.time() * 1000), "finishedAt": int(time.time() * 1000), "expected": {}, "actual": {}, "passed": all(r["passed"] for r in results), "metrics": {"markdown": (HERE / "RESULTS.md").read_text().split("## Metrics")[1] if "## Metrics" in (HERE / "RESULTS.md").read_text() else "", "passed": sum(1 for r in results if r["passed"]), "total": len(results)}})
        c.post("/eval/report", {"results": rows})
    passed = sum(1 for r in results if r["passed"])
    print(f"\n{passed}/{len(results)} passed. Wrote results.json and RESULTS.md")
    return 0 if passed == len(results) else 1

if __name__ == "__main__":
    sys.exit(main())
