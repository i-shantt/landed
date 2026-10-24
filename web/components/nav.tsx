"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ClockDisplay } from "./clock-display";

const LINKS = [
  { href: "/cases", label: "Cases" },
  { href: "/vendors", label: "Vendors" },
  { href: "/mailbox", label: "Mailbox" },
  { href: "/eval", label: "Eval" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-5">
          <Link href="/cases" className="font-semibold tracking-tight">
            Landed
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={cn("text-muted-foreground hover:text-foreground", path?.startsWith(l.href) && "text-foreground font-medium")}>
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <ClockDisplay />
      </div>
    </header>
  );
}
