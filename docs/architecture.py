# Generates docs/architecture.svg from a box spec and refuses lines that would overflow their box.
import sys
W, H = 1160, 660
F, S = 12, 10.5          # body and small font sizes
CW = 0.52                # average glyph width as a fraction of font size (sans, mixed case)
out = []
def est(text, size): return len(text) * size * CW
def box(x, y, w, h, fill, stroke, lines, title=None, sw=1, r=8):
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
    ty = y + 20
    if title:
        t, col = title
        assert est(t, F) <= w - 24, ("title overflow", t)
        out.append(f'<text x="{x+12}" y="{ty}" font-weight="700" fill="{col}">{t}</text>'); ty += 17
    for ln in lines:
        text, col, size = (ln + (F,))[:3] if len(ln) == 2 else ln
        assert est(text, size) <= w - 24, ("overflow", text, round(est(text, size)), w - 24)
        fs = f' font-size="{size}"' if size != F else ""
        out.append(f'<text x="{x+12}" y="{ty}" fill="{col}"{fs}>{text}</text>'); ty += 16 if size == F else 14
def arrow(x1, y1, x2, y2, col="#475569", m="a"):
    out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" stroke-width="1.5" marker-end="url(#{m})"/>')
SL, SM = "#0f172a", "#334155"; MUTED = "#64748b"
G1, G2, GF, GF2 = "#14532d", "#166534", "#f0fdf4", "#dcfce7"
O1, O2, OF = "#7c2d12", "#9a3412", "#fff7ed"
B1, B2, BF = "#1e3a8a", "#1e40af", "#eff6ff"
P1, P2, PF = "#581c87", "#6b21a8", "#fdf4ff"
# clients row
box(24, 24, 300, 92, "#f1f5f9", "#94a3b8", [("dashboard · cases · vendors · mailbox", SM), ("pay run · approvals · controls · monitoring", SM), ("Convex Auth session · proxy.ts gates routes", MUTED)], ("Next.js 16 workspace (Vercel)", SL))
box(340, 24, 244, 92, "#f1f5f9", "#94a3b8", [("Bearer ld_live_sk_… scoped, hashed", SM), ("/api/v1 · OpenAPI 3.1 · idempotent", SM), ("ERP · bank SFTP (payment files)", MUTED)], ("REST API clients", SL))
box(600, 24, 244, 92, "#f1f5f9", "#94a3b8", [("voice call to the number of record", SM), ("(Vapi + Cartesia) · vendor portal", SM), ("they read the probe amount back", MUTED)], ("Vendors", SL))
box(860, 24, 276, 92, "#f1f5f9", "#94a3b8", [("mailbox · .eml upload · ERP webhook", SM), ("extractor: rules | Claude · no writes", SM), ("SPF/DKIM/DMARC recorded, never assumed", MUTED)], ("Email intake", SL))
for x in (174, 462, 722, 998): arrow(x, 116, x, 150)
# convex container
out.append(f'<rect x="24" y="150" width="1112" height="414" rx="10" fill="#fafaf9" stroke="#78716c" stroke-dasharray="6 4"/>')
out.append(f'<text x="40" y="174" font-weight="700" fill="{SL}">Convex (serializable transactions, real-time queries, scheduler)</text>')
# frozen core
out.append(f'<rect x="40" y="190" width="520" height="206" rx="8" fill="{GF}" stroke="{GF2}" stroke-width="0"/>')
out.append(f'<rect x="40" y="190" width="520" height="206" rx="8" fill="{GF}" stroke="{G2}" stroke-width="2"/>')
out.append(f'<text x="52" y="210" font-weight="700" fill="{G1}">Frozen core: the payment boundary</text>')
out.append(f'<text x="52" y="227" fill="{G2}" font-size="{S}">changes only with a failing test first (core: commits)</text>')
box(52, 240, 156, 38, "#ffffff", G2, [("new version = unverified", G2, S)], ("bankAccounts", G1), r=6)
box(222, 240, 170, 38, "#ffffff", G2, [("HELD → PROBE → VERIFIED", G2, S)], ("cases · probes", G1), r=6)
box(406, 240, 142, 38, "#ffffff", G2, [("canRelease: 16 facts", G2, S)], ("confirmations", G1), r=6)
arrow(208, 259, 222, 259, G2, "g"); arrow(392, 259, 406, 259, G2, "g")
box(52, 296, 496, 86, GF2, G2, [("canPay: destination exists · belongs to this vendor · current version · verified", G1, S), ("then policy, which can only add refusals · idempotent per invoice + destination", G1, S), ("thrown error = refusal · refusal = payment_refused event · nothing reaches the rail", G2, S)], ("payments.send — the only writer of payments", G1), sw=2, r=6)
# controls / risk / monitoring / integration
box(576, 190, 272, 98, OF, "#c2410c", [("actor.ts: session → operator → role", O2), ("approvals: maker-checker, one payment", O2), ("policy JSON · screening (OFAC parsers)", O2), ("demo kill switch · invites by email", O2)], ("Controls", O1))
box(864, 190, 256, 98, BF, "#1d4ed8", [("16 deterministic signals + evidence", B2), ("payment LR (20 feats) · email TF-IDF", B2), ("combined = max(rules, model)", B2), ("weights JSON trained in ml/ (Python)", B2)], ("Risk (derived on read, no writes)", B1))
box(576, 298, 272, 98, BF, "#1d4ed8", [("velocity vs weekly median · robust z", B2), ("structuring under the threshold (72 h)", B2), ("dormant spike · trust score · trend API", B2), ("monitoringReviewAbove → approval required", B2, S)], ("Monitoring (vendor's own history)", B1))
box(864, 298, 256, 98, PF, "#7e22ce", [("apiRoutes.ts · API keys · OpenAPI", P2), ("webhooks: HMAC, retries, SSRF guard", P2), ("Nacha ACH · ISO 20022 pain.001 files", P2), ("full file server-side, masked in browser", P2, S)], ("Integration", P1))
arrow(576, 340, 548, 340, "#c2410c"); out.append(f'<text x="562" y="333" fill="{O2}" font-size="9.5" text-anchor="middle">policy</text>')
# shared / rails / channels / gate
box(40, 410, 1080, 56, "#f8fafc", "#94a3b8", [("events (append-only, redacted at insert, hash chain) · clock + timers.tick (SLA, availability, landing) · crypto (HMAC + AES-256-GCM) · key-gated seed/eval · auth tables", SM, S)], ("Shared services", SL))
box(40, 480, 330, 56, "#f8fafc", "#94a3b8", [("SimRail ledger · Capital One Nessie · one Rail interface", SM, S)], ("Rails", SL))
box(386, 480, 330, 56, "#f8fafc", "#94a3b8", [("SimVoice · Vapi + Cartesia (secret-bound hook) · portal", SM, S)], ("Channels", SL))
box(732, 480, 388, 56, "#f8fafc", "#94a3b8", [("268 vitest · 40-run scenarios · drift checks · Playwright · CI", SM, S)], ("Quality gate", SL))
# footer
out.append(f'<text x="24" y="594" fill="{SM}">Rule under everything: <tspan font-weight="700" fill="{G1}">no payment to a bank account that has not been verified for that specific vendor</tspan>, enforced in the transaction that would write it.</text>')
out.append(f'<text x="24" y="614" fill="{MUTED}">Intelligence (extractor, risk, model, monitoring) informs people and policy; none of it can import or schedule a release function (static test). Probe amounts never leave the server.</text>')
out.append(f'<text x="24" y="638" fill="#94a3b8" font-size="{S}">docs/architecture.svg · generated layout; see ARCHITECTURE.md for the module table and data model</text>')
head = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="{F}">
  <title>Landed architecture: workspace and API clients call Convex; every payment passes the frozen boundary</title>
  <defs>
    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker>
    <marker id="g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="{G2}"/></marker>
  </defs>
  <rect width="{W}" height="{H}" rx="12" fill="#ffffff"/>
'''
svg = head + "\n".join("  " + l for l in out) + "\n</svg>\n"
open(sys.argv[1], "w").write(svg); print("wrote", sys.argv[1], len(svg), "bytes")
