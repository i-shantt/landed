// Shape of /fixtures JSON (also used by the minimal inline fixture).
export type Fixture = {
  company: { name: string; domain: string; timezone: string; bankRouting?: string; bankLast4?: string };
  vendors: { slug: string; name: string; domain: string; onboardedAt: number; hasPortalLogin: boolean; notes?: string }[];
  contacts: { vendorSlug: string; kind: "phone" | "portal" | "email"; value: string; trustLevel: "record" | "discovered" | "untrusted"; establishedAt: number; establishedVia: string }[];
  bankAccounts: { vendorSlug: string; key: string; routing: string; accountNumber: string; status: "verified" | "unverified"; firstPaidAt?: number }[];
  invoices: { vendorSlug: string; number: string; amountCents: number; issuedAt: number; dueAt: number; remitAccountKey: string; status: "open" | "paid" }[];
  payments: { invoiceNumber: string; sentAt: number; rail: "ach" | "wire"; railRef: string }[];
  messages: { vendorSlug?: string; threadId: string; from: string; to: string; subject: string; body: string; sentAt: number; dmarc: boolean; invoiceNumber?: string }[];
  portalCredentials: { vendorSlug: string; username: string; password: string }[];
};
