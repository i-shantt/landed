#!/usr/bin/env node
// Single source for the learned-model numbers quoted in README.md and docs/CASE_STUDY.md.
// Reads ml/artifacts/metrics.json (written by `make -C ml all`) and the exported weight bundles, renders
// one paragraph, and writes it between <!-- model-metrics:start --> / <!-- model-metrics:end -->.
// `--check` only verifies and exits 1 on drift (scripts/verify.sh runs it). Files without markers are skipped.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "..");
const check = process.argv.includes("--check");

const m = JSON.parse(readFileSync(join(root, "ml", "artifacts", "metrics.json"), "utf8"));
const tx = JSON.parse(readFileSync(join(web, "convex", "risk", "weights", "transaction_lr.json"), "utf8"));
const txt = JSON.parse(readFileSync(join(web, "convex", "risk", "weights", "email_tfidf_lr.json"), "utf8"));
const f3 = (x) => (x === null || x === undefined ? "n/a" : x.toFixed(3));
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const c = m.transaction.combined, p = m.transaction.paysim, s = m.transaction.sparkov, t = m.text, ap = m.ap_scenarios;
const rows = (e) => e.rows.train + e.rows.val + e.rows.test;

const text = `Transaction model (logistic regression over ${tx.features.length} behavioural features, version \`${tx.version}\`) trained on ${(rows(c)).toLocaleString("en-US")} public PaySim and Sparkov rows with time-based splits; held-out test ROC-AUC ${f3(c.lr.test.roc_auc)} / PR-AUC ${f3(c.lr.test.pr_auc)} combined (PaySim ${f3(p.lr.test.roc_auc)} / ${f3(p.lr.test.pr_auc)}, Sparkov ${f3(s.lr.test.roc_auc)} / ${f3(s.lr.test.pr_auc)}), recall ${f3(c.lr.test.recall_at_fpr_1pct)} at a 1% false-positive rate; a gradient-boosted ceiling on the same features reaches ROC-AUC ${f3(c.gbm.test.roc_auc)} / PR-AUC ${f3(c.gbm.test.pr_auc)}. Email text model (TF-IDF ${txt.vocab.length.toLocaleString("en-US")} uni/bigrams + logistic regression, version \`${txt.version}\`) on ${(t.rows.train + t.rows.val + t.rows.test).toLocaleString("en-US")} phishing and advance-fee scam emails: test ROC-AUC ${f3(t.test.roc_auc)} / PR-AUC ${f3(t.test.pr_auc)}. On ${ap.payments.toLocaleString("en-US")} synthetic accounts-payable payments (our own generator, reported separately): new-vendor payment recall ${f3(ap.per_scenario.new_vendor_payment.recall)}, payment-redirect email recall ${f3(ap.per_scenario.lookalike_domain_request.recall)}, benign false-positive rate ${pct(ap.benign_fpr_transactions)}. TypeScript reproduces the Python scores on 100 parity fixtures to 1e-6. This paragraph is generated from \`ml/artifacts/metrics.json\` by \`web/scripts/sync-model-metrics.mjs\`; the gate fails if it drifts.`;

const START = "<!-- model-metrics:start -->", END = "<!-- model-metrics:end -->";
let drift = false, seen = 0;
for (const file of ["README.md", "docs/CASE_STUDY.md"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, "utf8");
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a === -1 || b === -1 || b < a) continue;
  seen++;
  const next = src.slice(0, a + START.length) + text + src.slice(b);
  if (next !== src) {
    drift = true;
    if (check) console.error(`${file}: model metrics are stale; run node web/scripts/sync-model-metrics.mjs`);
    else { writeFileSync(path, next); console.log(`${file}: model-metrics paragraph updated`); }
  } else console.log(`${file}: model-metrics paragraph current`);
}
if (seen === 0) throw new Error("no file carries the model-metrics markers");
console.log(`transaction ROC ${f3(c.lr.test.roc_auc)} PR ${f3(c.lr.test.pr_auc)}; text ROC ${f3(t.test.roc_auc)}`);
if (check && drift) process.exit(1);
