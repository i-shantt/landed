"use client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrustBadge } from "./badges";
import { absDate, absTime } from "@/lib/format";
import { CONTACT_KIND_LABELS } from "@/lib/labels";

export type Contact = { _id: string; kind: string; value: string; trustLevel: string; establishedAt: number; establishedVia: string; supersededAt?: number };

export function ContactList({ contacts, onSupersede }: { contacts: Contact[]; onSupersede?: (id: string) => void }) {
  const recordPhones = new Set(contacts.filter((c) => c.kind === "phone" && c.trustLevel === "record" && !c.supersededAt).map((c) => c.value));
  if (contacts.length === 0) return <p className="text-sm text-muted-foreground">No contacts.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>Trust</TableHead>
          <TableHead className="hidden md:table-cell">Established</TableHead>
          <TableHead className="w-24" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {contacts.map((c) => (
          <TableRow key={c._id}>
            <TableCell>{CONTACT_KIND_LABELS[c.kind] ?? c.kind}</TableCell>
            <TableCell className="font-mono text-xs">
              {c.value}
              {c.trustLevel === "discovered" && c.kind === "phone" && (
                <span className={`ml-2 font-sans text-[11px] ${recordPhones.has(c.value) ? "text-emerald-700" : "text-amber-800"}`}>
                  {recordPhones.has(c.value) ? "matches the phone of record" : "differs from the phone of record"}
                </span>
              )}
            </TableCell>
            <TableCell>
              <TrustBadge level={c.trustLevel} superseded={!!c.supersededAt} />
              {c.supersededAt && <span className="ml-2 text-[11px] text-muted-foreground">{absTime(c.supersededAt)}</span>}
            </TableCell>
            <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{absDate(c.establishedAt)} · {c.establishedVia.replace(/_/g, " ")}</TableCell>
            <TableCell className="text-right">
              {!c.supersededAt && onSupersede && (
                <Button size="xs" variant="outline" onClick={() => onSupersede(c._id)}>Supersede</Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
