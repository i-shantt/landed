"use client";
// Dependency-free SVG charts sized for the dashboard. Colours come from the brand palette.
import { cn } from "@/lib/utils";

export const PALETTE = ["#244d3e", "#4f8a6d", "#9bbfa8", "#d6a84a", "#c45c4a", "#6b7a72"];

export function Sparkline({ values, className, stroke = "#244d3e", height = 44 }: { values: number[]; className?: string; stroke?: string; height?: number }) {
  const w = 240;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, height - 4 - (v / max) * (height - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className={cn("h-11 w-full", className)} role="img" aria-label={`Trend over ${values.length} days, latest ${values[values.length - 1] ?? 0}`}>
      <path d={area} fill={stroke} opacity={0.08} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={stroke} />}
    </svg>
  );
}

export function Bars({ data, className, format = (n) => String(n) }: { data: { label: string; value: number; color?: string }[]; className?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={cn("space-y-1.5", className)} aria-label="Bar chart">
      {data.map((d, i) => (
        <li key={d.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-slate-700" title={d.label}>
            {d.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded bg-slate-100">
            <span className="block h-full rounded" style={{ width: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 100)}%`, background: d.color ?? PALETTE[i % PALETTE.length] }} />
          </span>
          <span className="font-mono tabular-nums text-slate-900">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Donut({ segments, size = 120, label, sublabel }: { segments: { label: string; value: number; color: string }[]; size?: number; label: string; sublabel?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        <circle cx={50} cy={50} r={r} fill="none" stroke="#eef1ee" strokeWidth={12} />
        {total > 0 &&
          segments.map((s) => {
            const len = (s.value / total) * c;
            const el = <circle key={s.label} cx={50} cy={50} r={r} fill="none" stroke={s.color} strokeWidth={12} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />;
            offset += len;
            return el;
          })}
        <text x={50} y={48} textAnchor="middle" fontSize={16} fontFamily="ui-monospace, monospace" fill="#1f2a25" fontWeight={600}>
          {total}
        </text>
        <text x={50} y={62} textAnchor="middle" fontSize={7} fill="#6b7a72">
          {label}
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-slate-700">{s.label}</span>
            <span className="ml-auto font-mono tabular-nums text-slate-900">{s.value}</span>
          </li>
        ))}
        {sublabel && <li className="pt-1 text-[11px] text-muted-foreground">{sublabel}</li>}
      </ul>
    </div>
  );
}
