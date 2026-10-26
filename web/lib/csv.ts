/**
 * CSV export shared by the Cases and Audit pages.
 *
 * RFC 4180: every field is quoted when it contains a comma, quote, CR or LF (we quote
 * unconditionally for simplicity and stable diffs), quotes are doubled, records end in CRLF.
 * Dates are written as ISO 8601 (UTC) so spreadsheets parse them unambiguously; objects are
 * serialised as JSON; null/undefined become empty fields.
 */
export type CsvValue = string | number | boolean | Date | null | undefined | object;

export function csvCell(v: CsvValue): string {
  let s: string;
  if (v === null || v === undefined) s = "";
  else if (v instanceof Date) s = Number.isNaN(v.getTime()) ? "" : v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return `"${s.replaceAll('"', '""')}"`;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [columns.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  return lines.join("\r\n") + "\r\n";
}

/** Triggers a browser download of `text` as `name`. No-op outside the browser. */
export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8"): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
