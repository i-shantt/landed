"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPortalSession } from "@/lib/portal-session";
import { errorMessage } from "@/components/reason-dialog";

export default function PortalLoginPage() {
  const login = useAction(api.portalAuth.login);
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <div className="rounded-md bg-slate-800 text-white px-4 py-3">
        <div className="text-lg font-semibold">Vendor payment portal (prototype)</div>
        <div className="text-xs text-slate-300">Sign in with the credentials issued at onboarding. This login is the portal contact of record.</div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Prototype: a bcrypt-checked username and password with a cookie session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="cleanco" autoComplete="username" />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="landed-demo" autoComplete="current-password" />
          </div>
          {err && <p className="text-sm text-red-700">{err}</p>}
          <Button
            disabled={busy || !username || !password}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const r = await login({ username, password });
                setPortalSession(r.token);
                router.push("/portal");
              } catch (e) {
                setErr(errorMessage(e) === "bad_credentials" ? "Wrong username or password." : errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
