"use client";
// Email + password sign-in (Convex Auth). Sign-up is by invitation: an administrator records the operator's email
// under Controls → Operators first; the first account on an empty deployment becomes the bootstrap administrator.
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { KeyRound, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/landed/Brand";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { DEMO_ACCOUNTS } from "@/convex/demoAccounts";
import { ROLE_LABEL, authErrorMessage } from "@/lib/labels";

type Flow = "signIn" | "signUp";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/signin")) return "/dashboard";
  return raw;
}

function SignInForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [flow, setFlow] = useState<Flow>("signIn");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("password", flow === "signUp" ? { email, password, name, flow } : { email, password, flow });
      router.replace(next);
    } catch (err) {
      setError(authErrorMessage(errorMessage(err)));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_minmax(0,320px)]">
      <form onSubmit={submit} className="rounded-xl border bg-white p-6 shadow-sm" aria-labelledby="signin-title">
        <h1 id="signin-title" className="text-lg font-semibold text-slate-900">
          {flow === "signIn" ? "Sign in to the workspace" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {flow === "signIn"
            ? "Operators sign in with the email an administrator recorded for them."
            : "Use the email your administrator added under Controls → Operators, then choose a password of at least 12 characters."}
        </p>
        <div className="mt-5 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.example" />
          </div>
          {flow === "signUp" && (
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Lee" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} required minLength={flow === "signUp" ? 12 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            <KeyRound size={14} aria-hidden /> {busy ? "Signing in…" : flow === "signIn" ? "Sign in" : "Create account"}
          </Button>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>
            {flow === "signIn" ? "Invited? Create your account" : "Already have an account? Sign in"}
          </button>
          <Link href="/" className="underline-offset-2 hover:underline">
            Landed website
          </Link>
        </div>
      </form>

      <aside className="rounded-xl border border-[#dfe5e2] bg-[#f4f7f5] p-5 text-sm" aria-labelledby="demo-title">
        <h2 id="demo-title" className="flex items-center gap-2 font-semibold text-[#2f4a3d]">
          <UserRound size={16} aria-hidden /> Reviewer access
        </h2>
        <p className="mt-1 text-xs text-[#557061]">Two demo operators on the shared demo data. Open each in its own browser to see maker-checker: the clerk requests, the approver decides.</p>
        <ul className="mt-3 space-y-2">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email} className="rounded-md border bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="block font-medium text-slate-900">{a.name}</span>
                  <span className="block text-[11px] text-muted-foreground">{ROLE_LABEL[a.role]} · {a.email}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFlow("signIn");
                    setEmail(a.email);
                    setPassword(a.password);
                    setError(null);
                  }}
                >
                  Use
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{a.blurb}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-muted-foreground">Demo accounts cannot change policy, mint API keys or manage webhooks and operators. Those need an administrator.</p>
      </aside>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="min-h-full bg-[#f8faf9]">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-4 text-sm">
          <Link href="/" aria-label="Landed home">
            <Brand />
          </Link>
          <span className="rounded border px-2 py-1 text-xs text-muted-foreground">Workspace sign-in</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-10">
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <SignInForm />
        </Suspense>
      </main>
    </div>
  );
}
