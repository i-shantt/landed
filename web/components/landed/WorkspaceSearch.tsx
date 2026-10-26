"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Search,
  ArrowUpRight,
  FolderKanban,
  Building2,
  Inbox,
  Banknote,
  ScrollText,
  Receipt,
  FileText,
  ClipboardCheck,
  LayoutDashboard,
  FlaskConical,
  Gavel,
  Presentation,
  Activity,
  SlidersHorizontal,
  Code2,
  Settings,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCases, useVendors } from "@/lib/hooks";
import { stateLabel } from "@/lib/labels";

// Mirrors the sidebar's NAV + TOOLS + UTILITY lists (Shell.tsx), so every page is reachable from search.
const pages = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, meta: "Page" },
  { label: "Verification cases", href: "/cases", icon: FolderKanban, meta: "Page" },
  { label: "Vendors", href: "/vendors", icon: Building2, meta: "Page" },
  { label: "Mailbox", href: "/mailbox", icon: Inbox, meta: "Page" },
  { label: "Payment run", href: "/payment-run", icon: Banknote, meta: "Page" },
  { label: "Payments", href: "/payments", icon: Receipt, meta: "Page" },
  { label: "Payment files", href: "/payment-files", icon: FileText, meta: "Page" },
  { label: "Approvals", href: "/approvals", icon: ClipboardCheck, meta: "Page" },
  { label: "Audit log", href: "/audit", icon: ScrollText, meta: "Page" },
  { label: "Evaluations", href: "/eval", icon: FlaskConical, meta: "Demo tool" },
  { label: "Scenario runner", href: "/judge", icon: Gavel, meta: "Demo tool" },
  { label: "Pitch deck", href: "/pitch", icon: Presentation, meta: "Demo tool" },
  { label: "System health", href: "/health", icon: Activity, meta: "Demo tool" },
  { label: "Controls", href: "/controls", icon: SlidersHorizontal, meta: "Settings" },
  { label: "Developers", href: "/developers", icon: Code2, meta: "Settings" },
  { label: "Settings", href: "/settings", icon: Settings, meta: "Settings" },
  { label: "About Landed", href: "/about", icon: Info, meta: "Settings" },
];

/** "⌘ K" on Apple platforms, "Ctrl K" elsewhere; resolves on the client only (server renders the neutral form). */
function useShortcutLabel() {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? "") || /Macintosh/i.test(navigator.userAgent) ? "⌘ K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

export function WorkspaceSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const cases = useCases();
  const vendors = useVendors();
  const shortcut = useShortcutLabel();
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
    ...pages.filter(
      (p) => !needle || p.label.toLowerCase().includes(needle) || p.meta.toLowerCase().includes(needle),
    ),
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
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search size={15} />
        <span>Search workspace</span>
        <kbd>{shortcut}</kbd>
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
