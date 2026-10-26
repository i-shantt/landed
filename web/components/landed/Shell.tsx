"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderKanban,
  Building2,
  Inbox,
  FlaskConical,
  Settings,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Gavel,
  Info,
  Presentation,
  Banknote,
  ScrollText,
  ChevronDown,
  Activity,
  ArrowUpRight,
  ShieldCheck,
  ClipboardCheck,
  SlidersHorizontal,
  LayoutDashboard,
  Receipt,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Brand } from "./Brand";
import { ClockChip } from "./ClockChip";
import { ModeChips } from "./ModeChips";
import { WorkspaceSearch } from "./WorkspaceSearch";
import { OperatorMenu } from "./OperatorMenu";
import { usePendingApprovalCount } from "@/lib/hooks";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases", label: "Verification cases", icon: FolderKanban },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/mailbox", label: "Mailbox", icon: Inbox },
  { href: "/payment-run", label: "Payment run", icon: Banknote },
  { href: "/payments", label: "Payments", icon: Receipt },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/audit", label: "Audit log", icon: ScrollText },
];
const TOOLS = [
  { href: "/eval", label: "Evaluations", icon: FlaskConical },
  { href: "/judge", label: "Scenario runner", icon: Gavel },
  { href: "/pitch", label: "Pitch deck", icon: Presentation },
  { href: "/health", label: "System health", icon: Activity },
];
const UTILITY = [
  { href: "/controls", label: "Controls", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/about", label: "About Landed", icon: Info },
];
function NavLinks({
  collapsed,
  onNavigate,
  items = NAV,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  items?: typeof NAV;
}) {
  const path = usePathname();
  const pending = usePendingApprovalCount();
  return (
    <nav
      aria-label={
        items === NAV
          ? "Primary"
          : items === TOOLS
            ? "Demo tools"
            : "Workspace settings"
      }
      className="ops-nav"
    >
      {items.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          aria-current={
            path === href || path?.startsWith(`${href}/`) ? "page" : undefined
          }
          aria-label={label}
          title={collapsed ? label : undefined}
          className={cn("workspace-nav-link", collapsed && "ops-nav-collapsed")}
        >
          <Icon size={16} aria-hidden />
          {!collapsed && <span>{label}</span>}
          {href === "/approvals" && pending ? (
            <span className="ml-auto rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900" aria-label={`${pending} pending`}>
              {pending}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const path = usePathname();
  const toolsActive = TOOLS.some((t) => path === t.href);
  return (
    <aside
      className={cn(
        "workspace-sidebar ops-sidebar",
        collapsed && "ops-sidebar-collapsed",
      )}
      aria-label="Sidebar"
    >
      <div className="ops-sidebar-brand">
        <Link href="/" aria-label="Landed home">
          <Brand compact={collapsed} />
        </Link>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={15} />
          ) : (
            <PanelLeftClose size={15} />
          )}
        </button>
      </div>
      {!collapsed && (
        <div className="ops-organization">
          <span>MO</span>
          <strong>Meridian Outdoor Co.</strong>
          <span className="ops-org-tag">Demo</span>
        </div>
      )}
      <div className="ops-nav-main">
        <NavLinks collapsed={collapsed} />
      </div>
      {!collapsed && (
        <details className="ops-demo-tools" open={toolsActive || undefined}>
          <summary>
            <FlaskConical size={15} />
            <span>Demo tools</span>
            <ChevronDown size={13} />
          </summary>
          <NavLinks items={TOOLS} />
        </details>
      )}
      <div className="ops-sidebar-bottom">
        <NavLinks collapsed={collapsed} items={UTILITY} />
        {!collapsed && (
          <Link href="/" className="ops-home-link">
            Landed website <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
    </aside>
  );
}
export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const path = usePathname();
  const current = [...NAV, ...TOOLS, ...UTILITY].find(
    (i) => path === i.href || path?.startsWith(`${i.href}/`),
  );
  return (
    <header className="ops-topbar">
      <div className="ops-topbar-main">
        <button
          type="button"
          className="ops-mobile-menu"
          onClick={onOpenMenu}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
        <span className="ops-breadcrumb">
          Workspace<span>/</span>
          <strong>{current?.label ?? "Landed"}</strong>
        </span>
        <div className="ops-topbar-actions">
          <WorkspaceSearch />
          <span className="ops-demo-environment">
            <span />
            Demo environment
          </span>
          <OperatorMenu />
        </div>
      </div>
    </header>
  );
}
function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4 text-sm">
          <Link href="/" aria-label="Landed home">
            <Brand />
          </Link>
          <span className="rounded border px-2 py-1 text-xs text-muted-foreground">
            Vendor portal
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-6">{children}</main>
    </div>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState(false);
  if (path === "/") return <>{children}</>;
  if (path?.startsWith("/portal") || path?.startsWith("/confirm"))
    return <PortalShell>{children}</PortalShell>;
  if (path?.startsWith("/pitch"))
    return <TooltipProvider delay={200}>{children}</TooltipProvider>;
  return (
    <TooltipProvider delay={200}>
      <a href="#main" className="ops-skip">
        Skip to content
      </a>
      <div className="workspace-shell">
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
        <div className="ops-workspace-main">
          <TopBar onOpenMenu={() => setMenu(true)} />
          <main id="main" className="ops-main-content">
            <div className="ops-content-width">{children}</div>
          </main>
          <div className="ops-environment-bar">
            <span>
              <ShieldCheck size={12} />
              Development workspace
            </span>
            <ClockChip />
          </div>
        </div>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="ops-mobile-sheet">
          <SheetTitle>
            <Brand />
          </SheetTitle>
          <NavLinks onNavigate={() => setMenu(false)} />
          <details className="ops-demo-tools">
            <summary>
              <FlaskConical size={15} />
              <span>Demo tools</span>
              <ChevronDown size={13} />
            </summary>
            <NavLinks items={TOOLS} onNavigate={() => setMenu(false)} />
          </details>
          <NavLinks items={UTILITY} onNavigate={() => setMenu(false)} />
          <ModeChips />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
