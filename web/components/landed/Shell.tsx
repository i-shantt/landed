"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderKanban, Building2, Inbox, FlaskConical, Settings, Menu, PanelLeftClose, PanelLeftOpen, Gavel, Info } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ClockChip } from "./ClockChip";
import { ModeChips } from "./ModeChips";

const NAV = [
  { href: "/cases", label: "Cases", icon: FolderKanban },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/mailbox", label: "Mailbox", icon: Inbox },
  { href: "/eval", label: "Eval", icon: FlaskConical },
  { href: "/judge", label: "Judge", icon: Gavel },
  { href: "/about", label: "About", icon: Info },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path === href || path?.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-slate-700 hover:bg-muted",
              active && "bg-accent text-accent-foreground font-medium",
              collapsed && "justify-center px-0"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span>{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={cn("hidden md:flex md:flex-col shrink-0 border-r bg-sidebar transition-[width]", collapsed ? "w-14" : "w-60")} aria-label="Sidebar">
      <div className={cn("flex h-12 items-center border-b px-3", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed && (
          <Link href="/cases" className="font-semibold tracking-tight text-slate-900">
            Landed
          </Link>
        )}
        <button type="button" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        </button>
      </div>
      <div className="py-2">
        <NavLinks collapsed={collapsed} />
      </div>
      {!collapsed && (
        <div className="mt-auto px-4 py-3 text-[11px] leading-snug text-muted-foreground">
          No payment to an account that is not verified for that vendor, even when the AI misses the email.
        </div>
      )}
    </aside>
  );
}

export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-sm">
      <div className="flex h-12 items-center gap-3 px-3 md:px-5">
        <button type="button" onClick={onOpenMenu} aria-label="Open navigation" className="rounded p-1 text-muted-foreground hover:bg-muted md:hidden">
          <Menu className="size-5" aria-hidden />
        </button>
        <Link href="/cases" className="font-semibold tracking-tight md:hidden">
          Landed
        </Link>
        <span className="hidden text-sm text-slate-700 md:inline">Meridian Outdoor Co. · Accounts payable</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden lg:block">
            <ModeChips />
          </div>
          <ClockChip />
        </div>
      </div>
      <div className="border-t border-amber-200 bg-amber-50 px-3 py-0.5 text-center text-[11px] text-amber-900 md:px-5">
        Prototype: simulated bank, time, and vendor responses unless Settings says otherwise.
      </div>
    </header>
  );
}

function PortalShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-11 max-w-2xl items-center justify-between px-4 text-sm">
          <span className="font-semibold">Vendor payment portal</span>
          <span className="rounded border px-1.5 text-[11px] text-muted-foreground">prototype</span>
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
  if (path?.startsWith("/portal") || path?.startsWith("/confirm")) return <PortalShell>{children}</PortalShell>;
  return (
    <TooltipProvider delay={200}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-2 focus:py-1 focus:text-sm">
        Skip to content
      </a>
      <div className="flex min-h-full">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenMenu={() => setMenu(true)} />
          <main id="main" className="min-w-0 flex-1 px-3 py-4 md:px-5 md:py-5">
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="top" className="p-3">
          <SheetTitle className="px-2 text-sm">Navigate</SheetTitle>
          <NavLinks onNavigate={() => setMenu(false)} />
          <div className="px-2 pt-2">
            <ModeChips />
          </div>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
