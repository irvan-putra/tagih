/* Unit tests for web/tagih.js core logic. Plain node, no dependencies:
   node tests/test_tagih.js */
"use strict";
const assert = require("assert");
const C = require("../web/tagih.js");

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log("ok - " + name);
}

function inv(over) {
  return C.normInvoice(Object.assign({
    id: "inv-test-1",
    number: "2026-001",
    client: "PT Uji",
    currency: "IDR",
    issued: "2026-11-01",
    due: "2026-11-15",
    items: [
      { desc: "Kerja desain", qty: 2, price_minor: 1000000 },
      { desc: "Revisi", qty: 1, price_minor: 500000 }
    ],
    payments: []
  }, over || {}));
}

t("totals: line items sum, zero payments", () => {
  const r = C.totals(inv());
  assert.strictEqual(r.total, 2500000);
  assert.strictEqual(r.paid, 0);
  assert.strictEqual(r.outstanding, 2500000);
});

t("totals: fractional qty rounds to minor units", () => {
  const i = inv({ currency: "USD", items: [{ desc: "Jam kerja", qty: 1.5, price_minor: 9999 }] });
  assert.strictEqual(C.totals(i).total, Math.round(1.5 * 9999));
});

t("status: draft when not sent", () => {
  const s = C.statusOf(inv({ sent: false }), "2026-11-10");
  assert.strictEqual(s.status, "draft");
  assert.strictEqual(s.overdue, false);
});

t("status: sent, then partial, then paid", () => {
  const i = inv({ sent: true });
  assert.strictEqual(C.statusOf(i, "2026-11-10").status, "sent");
  i.payments.push(C.normPayment({ date: "2026-11-05", amount_minor: 1000000, note: "DP" }));
  assert.strictEqual(C.statusOf(i, "2026-11-10").status, "partial");
  assert.strictEqual(C.totals(i).outstanding, 1500000);
  i.payments.push(C.normPayment({ date: "2026-11-12", amount_minor: 1500000, note: "" }));
  const s = C.statusOf(i, "2026-11-20");
  assert.strictEqual(s.status, "paid");
  assert.strictEqual(s.overdue, false); // paid invoices are never overdue
});

t("status: overdue counts whole days late", () => {
  const i = inv({ sent: true });
  const s = C.statusOf(i, "2026-11-20");
  assert.strictEqual(s.overdue, true);
  assert.strictEqual(s.daysLate, 5);
});

t("status: partial and overdue at once", () => {
  const i = inv({ sent: true });
  i.payments.push(C.normPayment({ date: "2026-11-05", amount_minor: 100 }));
  const s = C.statusOf(i, "2026-11-20");
  assert.strictEqual(s.status, "partial");
  assert.strictEqual(s.overdue, true);
});

t("money: IDR formats with Indonesian grouping, no decimals", () => {
  // Intl renders the IDR symbol with a non-breaking space (U+00A0).
  assert.strictEqual(C.formatMoney(2500000, "IDR"), "Rp\u00a02.500.000");
});

t("money: USD keeps two decimals", () => {
  assert.strictEqual(C.formatMoney(123456, "USD"), "$1,234.56");
});

t("toMinor respects currency decimals", () => {
  assert.strictEqual(C.toMinor("12.34", "USD"), 1234);
  assert.strictEqual(C.toMinor("1500000", "IDR"), 1500000);
  assert.strictEqual(C.toMinor("abc", "IDR"), 0);
});

t("nextInvoiceNumber: per-year counter, zero padded", () => {
  const list = [inv({ number: "2026-007" }), inv({ number: "2026-042" }), inv({ number: "2025-099" })];
  assert.strictEqual(C.nextInvoiceNumber(list, 2026), "2026-043");
  assert.strictEqual(C.nextInvoiceNumber([], 2027), "2027-001");
});

t("sort: unpaid by due date first, paid at the bottom", () => {
  const late = inv({ id: "a", number: "2026-001", due: "2026-11-10", sent: true });
  const soon = inv({ id: "b", number: "2026-002", due: "2026-11-30", sent: true });
  const paid = inv({ id: "c", number: "2026-003", due: "2026-11-01", sent: true });
  paid.payments.push(C.normPayment({ date: "2026-11-02", amount_minor: 2500000 }));
  const sorted = C.sortForList([paid, soon, late], "2026-11-20");
  assert.deepStrictEqual(sorted.map(i => i.id), ["a", "b", "c"]);
});

t("exportJSON round-trips through parseImport", () => {
  const store = C.emptyStore();
  store.invoices.push(inv());
  const back = C.parseImport(C.exportJSON(store));
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].client, "PT Uji");
  assert.strictEqual(C.totals(back[0]).total, 2500000);
});

t("parseImport rejects non-JSON and non-backup JSON", () => {
  assert.throws(() => C.parseImport("not json {"), /not valid JSON/);
  assert.throws(() => C.parseImport('{"hello": 1}'), /not a tagih backup/);
});

t("mergeImport never overwrites: colliding ids get fresh ones", () => {
  const store = C.emptyStore();
  store.invoices.push(inv());
  const dup = inv(); // same id "inv-test-1"
  const n = C.mergeImport(store, [dup]);
  assert.strictEqual(n, 1);
  assert.strictEqual(store.invoices.length, 2);
  assert.notStrictEqual(store.invoices[0].id, store.invoices[1].id);
});

t("validation: client and at least one item required", () => {
  assert.throws(() => C.normInvoice({ client: " ", items: [{ desc: "x", qty: 1, price_minor: 1 }] }), /client/);
  assert.throws(() => C.normInvoice({ client: "PT X", items: [] }), /at least one item/);
  assert.throws(() => C.normInvoice({ client: "PT X", items: [{ desc: " ", qty: 1, price_minor: 1 }] }), /description/);
  assert.throws(() => C.normInvoice({ client: "PT X", items: [{ desc: "x", qty: 0, price_minor: 1 }] }), /quantity/);
});

t("validation: payments must be positive, bad dates fall back to today", () => {
  assert.throws(() => C.normPayment({ amount_minor: 0 }), /above 0/);
  const p = C.normPayment({ date: "yesterday", amount_minor: 500 });
  assert.ok(C.isDateStr(p.date));
});

t("invoicesCSV: header plus one row, overdue marked, commas escaped", () => {
  const store = C.emptyStore();
  store.invoices.push(inv({ client: 'PT "Koma, Jaya"', sent: true }));
  const csv = C.invoicesCSV(store, "2026-11-20");
  const lines = csv.trim().split("\n");
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0], "number,client,currency,issued,due,status,total,paid,outstanding");
  assert.ok(lines[1].includes('"PT ""Koma, Jaya"""'));
  assert.ok(lines[1].includes("sent (overdue)"));
  assert.ok(lines[1].endsWith(",2500000,0,2500000"));
});

t("paymentsCSV: one row per payment with invoice context", () => {
  const store = C.emptyStore();
  const i = inv({ sent: true });
  i.payments.push(C.normPayment({ date: "2026-11-05", amount_minor: 1000000, note: "DP" }));
  i.payments.push(C.normPayment({ date: "2026-11-12", amount_minor: 1500000, note: "" }));
  store.invoices.push(i);
  const lines = C.paymentsCSV(store).trim().split("\n");
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[1], "2026-001,PT Uji,2026-11-05,1000000,IDR,DP");
  assert.strictEqual(lines[2], "2026-001,PT Uji,2026-11-12,1500000,IDR,");
});

t("archive flag survives normalization; status still computed underneath", () => {
  const i = inv({ archived: true, sent: true });
  assert.strictEqual(i.archived, true);
  assert.strictEqual(C.statusOf(i, "2026-11-10").status, "sent");
});

console.log("\n" + passed + " tests passed");
