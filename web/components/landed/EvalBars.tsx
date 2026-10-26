"use client";
// Hand-rolled SVG bars for the eval page: blocked / completed / escalated by family. No chart library.
type Row = { scenarioId: string; passed?: boolean; actual: Record<string, unknown>; metrics?: Record<string, unknown> };

const FAMILIES = ["compromised_inbox", "lookalike", "misdirection", "legit", "recovery"];
const LABELS: Record<string, string> = { compromised_inbox: "Compromised inbox", lookalike: "Lookalike", misdirection: "Misdirection", legit: "Legitimate", recovery: "Recovery" };

export function summarize(rows: Row[]) {
  const out = FAMILIES.map((fam) => {
    const list = rows.filter((r) => r.scenarioId.replace(/_\d+(__off)?$/, "") === fam);
    const blocked = list.filter((r) => fam !== "legit" && Number(r.actual.payments_to_new_destination ?? 0) === 0 && Number(r.actual.payments_created ?? 0) === 0 && r.actual.final_state !== null).length;
    const completed = list.filter((r) => r.actual.final_state === "CLOSED" && Number(r.actual.payments_created ?? 0) >= 1).length;
    const escalated = list.filter((r) => r.actual.final_state === "NEEDS_HUMAN" || r.actual.final_state === "RECOVERY").length;
    return { fam, total: list.length, blocked, completed, escalated };
  }).filter((x) => x.total > 0);
  return out;
}

export function EvalBars({ rows }: { rows: Row[] }) {
  const data = summarize(rows);
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.total));
  const W = 560, rowH = 26, left = 130, barMax = W - left - 40;
  const H = data.length * rowH + 28;
  const series: { key: "blocked" | "completed" | "escalated"; color: string; label: string }[] = [
    { key: "blocked", color: "var(--primary)", label: "blocked before payment" },
    { key: "completed", color: "#047857", label: "completed (paid and landed)" },
    { key: "escalated", color: "#B45309", label: "escalated to a human" },
  ];
  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Eval outcomes by scenario family" className="max-w-[640px] text-[11px]">
        {data.map((d, i) => {
          const y = i * rowH + 6;
          let x = left;
          return (
            <g key={d.fam}>
              <text x={left - 8} y={y + 13} textAnchor="end" fill="#334155">{LABELS[d.fam] ?? d.fam} ({d.total})</text>
              {series.map((s) => {
                const w = (d[s.key] / max) * barMax;
                const el = (
                  <g key={s.key}>
                    <rect x={x} y={y} width={w} height={16} fill={s.color} rx={2}>
                      <title>{`${LABELS[d.fam]}: ${d[s.key]} ${s.label}`}</title>
                    </rect>
                    {w > 14 && <text x={x + 4} y={y + 12} fill="#fff" fontFamily="ui-monospace, monospace">{d[s.key]}</text>}
                  </g>
                );
                x += w;
                return el;
              })}
            </g>
          );
        })}
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${left + i * 150}, ${H - 12})`}>
            <rect width={10} height={10} fill={s.color} rx={2} />
            <text x={14} y={9} fill="#334155">{s.label}</text>
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">Counts per family across all posted runs (extractor on and off). A run counts as blocked when no payment reached the requested destination.</figcaption>
    </figure>
  );
}
