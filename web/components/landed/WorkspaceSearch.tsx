"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  ArrowUpRight,
  FolderKanban,
  Building2,
  Inbox,
  Banknote,
  ScrollText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCases, useVendors } from "@/lib/hooks";
import { stateLabel } from "@/lib/labels";

const pages = [
  { label: "Verification cases", href: "/cases", icon: FolderKanban },
  { label: "Vendors", href: "/vendors", icon: Building2 },
  { label: "Mailbox", href: "/mailbox", icon: Inbox },
  { label: "Payment run", href: "/payment-run", icon: Banknote },
  { label: "Audit log", href: "/audit", icon: ScrollText },
];
export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cases = useCases();
  const vendors = useVendors();
  const needle = query.trim().toLowerCase();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const results = [
    ...pages
      .filter((p) => !needle || p.label.toLowerCase().includes(needle))
      .map((p) => ({ ...p, meta: "Page" })),
    ...(needle
      ? (cases ?? [])
          .filter((c) =>
            `${c.vendorName} ${c._id}`.toLowerCase().includes(needle),
          )
          .slice(0, 6)
          .map((c) => ({
            label: c.vendorName,
            href: `/cases/${c._id}`,
            icon: FolderKanban,
            meta: stateLabel(c.state),
          }))
      : []),
    ...(needle
      ? (vendors ?? [])
          .filter((v) => `${v.name} ${v.domain}`.toLowerCase().includes(needle))
          .slice(0, 6)
          .map((v) => ({
            label: v.name,
            href: `/vendors/${v._id}`,
            icon: Building2,
            meta: "Vendor",
          }))
      : []),
  ];
  return (
    <>
      <button
        type="button"
        className="ops-global-search"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        aria-label="Search workspace"
      >
        <Search size={15} />
        <span>Search workspace</span>
        <kbd>⌘ K</kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="ops-search-dialog"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>Search workspace</DialogTitle>
          </DialogHeader>
          <div className="ops-search-field">
            <Search size={17} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a vendor, case, or page"
              aria-label="Search workspace records"
            />
          </div>
          <div className="ops-command-results">
            {results.map(({ href, label, meta, icon: Icon }) => (
              <Link
                key={`${href}-${meta}`}
                href={href}
                onClick={() => setOpen(false)}
              >
                <Icon size={17} />
                <strong>{label}</strong>
                <span>{meta}</span>
                <ArrowUpRight size={14} />
              </Link>
            ))}
            {!results.length && <p>No results found.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
