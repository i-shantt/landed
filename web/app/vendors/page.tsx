"use client";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { absDate } from "@/lib/format";

export default function VendorsPage() {
  const vendors = useQuery(api.vendors.list, {});
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Vendors</h1>
        <p className="text-sm text-muted-foreground">Contacts of record and versioned bank accounts.</p>
      </div>
      {vendors === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Onboarded</TableHead>
              <TableHead>Portal</TableHead>
              <TableHead className="text-right">Accounts (verified)</TableHead>
              <TableHead className="text-right">Open cases</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vendors.map((v) => (
              <TableRow key={v._id} className="cursor-pointer" onClick={() => router.push(`/vendors/${v._id}`)}>
                <TableCell className="font-medium">{v.name}</TableCell>
                <TableCell className="font-mono text-sm">{v.domain}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{absDate(v.onboardedAt)}</TableCell>
                <TableCell>{v.hasPortalLogin ? <Badge variant="outline">portal</Badge> : <span className="text-muted-foreground text-sm">—</span>}</TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {v.accountCount} ({v.verifiedCount})
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{v.openCases}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
