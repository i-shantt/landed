// Capital One Nessie rail (optional; RAIL=nessie + NESSIE_KEY). Time-boxed.
// Until wired, sendCredit throws so the engine's fail-closed path records the
// error; the default rail stays "sim". See OPEN_QUESTIONS.md.
import type { ActionCtx } from "../_generated/server";
import type { Rail, RailStatus } from "./types";

const BASE = "http://api.nessieisreal.com";

export class NessieRail implements Rail {
  name = "nessie" as const;
  constructor(private ctx: ActionCtx, private key: string) {}

  private url(path: string) {
    return `${BASE}${path}${path.includes("?") ? "&" : "?"}key=${this.key}`;
  }

  async sendCredit(args: { routing: string; accountNumber: string; amountCents: number; memo: string; idempotencyKey: string }): Promise<{ railRef: string }> {
    // Implemented in Tier 3 (section 9 step 16). Placeholder keeps the interface honest.
    void args;
    throw new Error("NessieRail not wired yet; set RAIL=sim");
  }

  async getStatus(railRef: string): Promise<RailStatus> {
    const res = await fetch(this.url(`/transfers/${railRef}`));
    if (!res.ok) return "submitted";
    const json = (await res.json()) as { status?: string };
    return json.status === "completed" ? "settled" : "submitted";
  }
}
