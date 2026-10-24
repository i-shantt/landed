// Capital One Nessie rail (optional; RAIL=nessie + NESSIE_KEY). Verified live on
// 2026-10-24 over HTTPS (the http:// host does not answer). Shape of the current API:
//   POST /customers, POST /customers/{id}/accounts, POST /accounts/{id}/deposits,
//   POST /accounts/{id}/withdrawals, GET /deposits/{id}. Transfers have no payee field
//   in this version, so a credit is modeled as a deposit to the destination account plus
//   a withdrawal from the company account.
// Limitation: Nessie stores `amount` as an integer. Sub-dollar probes would become 0, so
// amounts are sent in integer CENTS with the unit stated in the description. The vendor
// statement comparison in Landed never reads Nessie; it reads the probes table.
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Rail, RailStatus } from "./types";

const BASE = "https://api.nessieisreal.com";

export class NessieRail implements Rail {
  name = "nessie" as const;
  constructor(private ctx: ActionCtx, private key: string) {}

  private url(path: string) {
    return `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${this.key}`;
  }
  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path), { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`nessie ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }
  private async setting(key: string): Promise<string | null> {
    return this.ctx.runQuery(internal.settingsInternal.getInternal, { key });
  }
  private async setSetting(key: string, value: string) {
    await this.ctx.runMutation(internal.settingsInternal.setInternal, { key, value });
  }

  /** Company customer + operating account, created once and remembered in settings. */
  private async companyAccountId(): Promise<string> {
    const existing = await this.setting("nessie:companyAccountId");
    if (existing) return existing;
    const cust = await this.req<{ objectCreated: { _id: string } }>("POST", "/customers", {
      first_name: "Meridian", last_name: "Outdoor AP",
      address: { street_number: "100", street_name: "Market St", city: "San Francisco", state: "CA", zip: "94105" },
    });
    await this.setSetting("nessie:customerId", cust.objectCreated._id);
    const acct = await this.req<{ objectCreated: { _id: string } }>("POST", `/customers/${cust.objectCreated._id}/accounts`, {
      type: "Checking", nickname: "Meridian operating", rewards: 0, balance: 100_000_000,
    });
    await this.setSetting("nessie:companyAccountId", acct.objectCreated._id);
    return acct.objectCreated._id;
  }

  /** One Nessie account per destination (routing + last4); created lazily under the company customer. */
  private async destinationAccountId(routing: string, accountNumber: string): Promise<string> {
    const key = `nessie:account:${routing}:${accountNumber.slice(-4)}`;
    const existing = await this.setting(key);
    if (existing) return existing;
    await this.companyAccountId();
    const customerId = (await this.setting("nessie:customerId"))!;
    const acct = await this.req<{ objectCreated: { _id: string } }>("POST", `/customers/${customerId}/accounts`, {
      type: "Checking", nickname: `Destination ${routing} …${accountNumber.slice(-4)}`, rewards: 0, balance: 0,
    });
    await this.setSetting(key, acct.objectCreated._id);
    return acct.objectCreated._id;
  }

  async sendCredit(args: { routing: string; accountNumber: string; amountCents: number; memo: string; idempotencyKey: string }): Promise<{ railRef: string }> {
    const refKey = `nessie:ref:${args.idempotencyKey}`;
    const prior = await this.setting(refKey);
    if (prior) return { railRef: prior };
    const company = await this.companyAccountId();
    const dest = await this.destinationAccountId(args.routing, args.accountNumber);
    const date = new Date().toISOString().slice(0, 10);
    const description = `${args.memo} (amount in cents: ${args.amountCents})`;
    const dep = await this.req<{ objectCreated: { _id: string } }>("POST", `/accounts/${dest}/deposits`, {
      medium: "balance", transaction_date: date, status: "pending", amount: args.amountCents, description,
    });
    await this.req("POST", `/accounts/${company}/withdrawals`, {
      medium: "balance", transaction_date: date, status: "pending", amount: args.amountCents, description,
    });
    const railRef = `NESSIE-DEP-${dep.objectCreated._id}`;
    await this.setSetting(refKey, railRef);
    return { railRef };
  }

  async getStatus(railRef: string): Promise<RailStatus> {
    const id = railRef.replace(/^NESSIE-DEP-/, "");
    try {
      const dep = await this.req<{ status?: string }>("GET", `/deposits/${id}`);
      if (dep.status === "completed" || dep.status === "executed") return "settled";
      if (dep.status === "cancelled") return "returned";
      return "submitted";
    } catch {
      return "submitted";
    }
  }
}
