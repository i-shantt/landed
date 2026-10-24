"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { PageHeader, Loading, EmptyState } from "@/components/landed/primitives";
import { useVendors } from "@/lib/hooks";
import { absDate } from "@/lib/format";

export default function VendorsPage() {
  const vendors = useVendors();
  const router = useRouter();
  const [q, setQ] = useState("");
  const rows = (vendors ?? []).filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase()) || v.domain.includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <PageHeader title="Vendors" description="Contacts of record and versioned bank accounts." actions={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors…" aria-label="Search vendors" className="h-8 w-56" />} />
      {vendors === undefined ? (
        <Loading />
      ) : vendors.length === 0 ? (
        <EmptyState title="No vendors" description="Re-seed the fixtures from Settings." action={{ label: "Open settings", href: "/settings" }} />
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="hidden sm:table-cell">Domain</TableHead>
                <TableHead className="hidden md:table-cell">Onboarded</TableHead>
                <TableHead>Portal</TableHead>
                <TableHead className="text-right">Accounts (verified)</TableHead>
                <TableHead className="text-right">Open cases</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow key={v._id} className="cursor-pointer hover:bg-muted/60" tabIndex={0} onClick={() => router.push(`/vendors/${v._id}`)} onKeyDown={(e) => { if (e.key === "Enter") router.push(`/vendors/${v._id}`); }}>
                  <TableCell className="font-medium text-slate-900">{v.name}</TableCell>
                  <TableCell className="hidden sm:table-cell font-mono text-xs">{v.domain}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{absDate(v.onboardedAt)}</TableCell>
                  <TableCell className="text-xs">{v.hasPortalLogin ? <span className="rounded border px-1.5 text-[11px]">portal login</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{v.accountCount} ({v.verifiedCount})</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{v.openCases}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
