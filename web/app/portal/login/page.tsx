"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/landed/primitives";
import { PortalFrame } from "@/components/landed/PortalFrame";
import { errorMessage } from "@/components/landed/ReasonDialog";
import { usePortalActions } from "@/lib/hooks";
import { setPortalSession } from "@/lib/portal-session";

export default function PortalLoginPage() {
  const { login } = usePortalActions();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <PortalFrame vendorName="Vendor" subtitle="Sign in with the credentials issued at onboarding. This login is the portal contact of record.">
      <Section title="Sign in" description="Prototype: a bcrypt-checked username and password with a cookie session.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await login({ username, password }); setPortalSession(r.token); router.push("/portal"); } catch (er) { setErr(errorMessage(er) === "bad_credentials" ? "Wrong username or password." : errorMessage(er)); } finally { setBusy(false); } }}>
          <div className="space-y-1">
            <Label htmlFor="pl-user">Username</Label>
            <Input id="pl-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="cleanco" autoComplete="username" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-pass">Password</Label>
            <Input id="pl-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="landed-demo" autoComplete="current-password" />
          </div>
          {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
          <Button type="submit" disabled={busy || !username || !password}>Sign in</Button>
        </form>
      </Section>
    </PortalFrame>
  );
}
