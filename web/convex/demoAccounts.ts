// Public by design: résumé reviewers use these on /signin. An approver cannot change policy, mint API keys,
// manage webhooks or operators; the clerk is the maker in maker-checker. Both live in auth tables that
// reseed never touches. No server imports here so the sign-in page can bundle this file.
export type DemoAccount = { email: string; name: string; role: "approver" | "clerk"; password: string; blurb: string };

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "demo@landed.example", name: "Demo Approver", role: "approver", password: "landed-demo-approver", blurb: "Approve requests, review screening hits, attest landings, build payment files." },
  { email: "clerk@landed.example", name: "Demo Clerk", role: "clerk", password: "landed-demo-clerk-2026", blurb: "Request approvals and run the payment run; a second browser for maker-checker." },
];
