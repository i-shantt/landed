#!/usr/bin/env node
// Generates real invoice PDFs (text layer) for the demo vendor with pdf-lib.
// One carries a different remit account in the footer (the compromised_inbox_02 scenario).
// Usage: cd web && node scripts/make-fixture-pdfs.mjs   (writes ../fixtures/*.pdf)
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync, readFileSync } from "node:fs";

async function invoice({ number, amount, remitRouting, remitAccount, date, due, file }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = (t, x, y, size = 11, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(t, { x, y, size, font: f, color });
  text("CleanCo Facilities", 50, 740, 20, bold);
  text("118 Harbor View Road, Oakland, CA 94607  ·  ap@cleanco.example", 50, 722, 9);
  text("INVOICE", 450, 740, 16, bold);
  text(`No. ${number}`, 450, 722, 10);
  text(`Date: ${date}`, 450, 708, 10);
  text(`Due: ${due}`, 450, 694, 10);
  text("Bill to: Meridian Outdoor Co., Accounts Payable, 100 Market St, San Francisco, CA 94105", 50, 670, 10);
  page.drawLine({ start: { x: 50, y: 650 }, end: { x: 562, y: 650 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  text("Description", 50, 632, 10, bold); text("Qty", 400, 632, 10, bold); text("Amount", 500, 632, 10, bold);
  const lines = [["Facilities services, October (3 sites)", "1", amount], ["Deep clean, warehouse B", "1", "$0.00"]];
  let y = 612;
  for (const [d, q, a] of lines) { text(d, 50, y, 10); text(q, 400, y, 10); text(a, 500, y, 10); y -= 16; }
  page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: 562, y: y - 4 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  text("Total due", 400, y - 22, 11, bold); text(amount, 500, y - 22, 11, bold);
  text("Terms: Net 14. Thank you for your business.", 50, 120, 9);
  // footer: remit-to block
  page.drawLine({ start: { x: 50, y: 100 }, end: { x: 562, y: 100 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  text(`Remit to: First Harbor Bank   ABA ${remitRouting}   Account ${remitAccount}   (CleanCo Facilities LLC)`, 50, 84, 9, bold, rgb(0.25, 0.25, 0.25));
  text("Questions: ap@cleanco.example  ·  (555) 010-0000", 50, 70, 8);
  writeFileSync(file, await pdf.save({ useObjectStreams: false }));
  console.log("wrote", file);
}

// Real account on file, read from the fixture so the PDF matches the seed exactly.
const onFile = JSON.parse(readFileSync("../fixtures/bankAccounts.json", "utf8")).find((a) => a.vendorSlug === "cleanco");
await invoice({ number: "CC-2026-0412", amount: "$42,000.00", remitRouting: onFile.routing, remitAccount: onFile.accountNumber, date: "2026-10-16", due: "2026-10-30", file: "../fixtures/invoice_CC-2026-0412.pdf" });
// Changed footer: attacker account
await invoice({ number: "CC-2026-0419", amount: "$18,400.00", remitRouting: "011000015", remitAccount: "900012345678", date: "2026-10-23", due: "2026-11-06", file: "../fixtures/invoice_CC-2026-0419_footer.pdf" });
