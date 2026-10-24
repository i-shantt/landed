// Client-side mirror of convex/audit.ts: canonical JSON (sorted keys) and the SHA-256 hash chain
// h_i = sha256(h_{i-1} | at | actor | type | canonical(payload)), starting from "landed-genesis".
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function chainOver(events: { at: number; actor: string; type: string; payload: unknown }[]): Promise<{ head: string; count: number }> {
  let prev = "landed-genesis";
  for (const e of events) prev = await sha256Hex(`${prev}|${e.at}|${e.actor}|${e.type}|${canonical(e.payload ?? {})}`);
  return { head: prev, count: events.length };
}
