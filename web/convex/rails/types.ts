export type RailStatus = "submitted" | "settled" | "available" | "returned";

export interface Rail {
  name: "sim" | "nessie";
  sendCredit(args: {
    routing: string;
    accountNumber: string;
    amountCents: number;
    memo: string;
    idempotencyKey: string;
  }): Promise<{ railRef: string }>;
  getStatus(railRef: string): Promise<RailStatus>;
}
