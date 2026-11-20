/* tagih core: invoice math, status, serialization.
   No DOM in this file: it runs in the browser (window.TagihCore) and in
   node (module.exports) so the same logic is unit-tested in CI. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TagihCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var APP = "tagih";
  var STORE_VERSION = 1;
  var STORAGE_KEY = "tagih.v1";

  var CURRENCIES = [
    { code: "IDR", decimals: 0, locale: "id-ID" },
    { code: "USD", decimals: 2, locale: "en-US" },
    { code: "SGD", decimals: 2, locale: "en-SG" },
    { code: "EUR", decimals: 2, locale: "de-DE" },
    { code: "JPY", decimals: 0, locale: "ja-JP" }
  ];

  function currencyInfo(code) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].code === code) return CURRENCIES[i];
    }
    return CURRENCIES[0];
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function isDateStr(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var t = new Date(s + "T00:00:00Z");
    return !isNaN(t.getTime()) && s === t.toISOString().slice(0, 10);
  }

  function daysBetween(a, b) {
    // whole days from date string a to date string b (b - a)
    return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
  }

  /* Amounts are integer minor units (cents); IDR and JPY have 0 decimals.
     qty may be fractional (hours); line totals round to the nearest minor unit. */
  function toMinor(amount, code) {
    var d = currencyInfo(code).decimals;
    var n = Number(amount);
    if (!isFinite(n)) return 0;
    return Math.round(n * Math.pow(10, d));
  }

  function lineTotalMinor(item, code) {
    var qty = Number(item.qty);
    var price = Number(item.price_minor);
    if (!isFinite(qty) || !isFinite(price)) return 0;
    return Math.round(qty * price);
  }

  function totals(invoice) {
    var total = 0;
    (invoice.items || []).forEach(function (it) {
      total += lineTotalMinor(it, invoice.currency);
    });
    var paid = 0;
    (invoice.payments || []).forEach(function (p) {
      var a = Number(p.amount_minor);
      if (isFinite(a) && a > 0) paid += a;
    });
    return { total: total, paid: paid, outstanding: Math.max(0, total - paid) };
  }

  /* status: draft | sent | partial | paid; overdue is a separate flag so a
     partially paid invoice is both "partial" and overdue. */
  function statusOf(invoice, today) {
    today = today || todayStr();
    var t = totals(invoice);
    var status;
    if (!invoice.sent) status = "draft";
    else if (t.total > 0 && t.paid >= t.total) status = "paid";
    else if (t.paid > 0) status = "partial";
    else status = "sent";
    var overdue = status !== "paid" && status !== "draft" &&
      isDateStr(invoice.due) && invoice.due < today;
    return {
      status: status,
      overdue: overdue,
      daysLate: overdue ? daysBetween(invoice.due, today) : 0
    };
  }

  function formatMoney(minor, code) {
    var info = currencyInfo(code);
    var major = minor / Math.pow(10, info.decimals);
    try {
      return new Intl.NumberFormat(info.locale, {
        style: "currency", currency: info.code,
        minimumFractionDigits: info.decimals,
        maximumFractionDigits: info.decimals
      }).format(major);
    } catch (e) {
      return info.code + " " + major.toFixed(info.decimals);
    }
  }

  var uidCounter = 0;
  function uid(prefix) {
    uidCounter = (uidCounter + 1) % 1000;
    return (prefix || "inv") + "-" + Date.now().toString(36) + "-" + uidCounter.toString(36);
  }

  function nextInvoiceNumber(invoices, year) {
    var best = 0;
    var re = new RegExp("^" + year + "-(\\d+)$");
    (invoices || []).forEach(function (inv) {
      var m = re.exec(inv.number || "");
      if (m) best = Math.max(best, parseInt(m[1], 10));
    });
    return year + "-" + ("00" + (best + 1)).slice(-3);
  }

  function emptyStore() {
    return { app: APP, version: STORE_VERSION, updated_at: null, invoices: [] };
  }

  /* Normalization + validation. Throws Error with a human message on bad input. */
  function normItem(raw) {
    if (!raw || typeof raw !== "object") throw new Error("invoice item is not an object");
    var desc = String(raw.desc == null ? "" : raw.desc).trim();
    if (!desc) throw new Error("invoice item needs a description");
    var qty = Number(raw.qty);
    if (!isFinite(qty) || qty <= 0) throw new Error("item '" + desc + "' needs a quantity above 0");
    var price = Number(raw.price_minor);
    if (!isFinite(price) || price < 0) throw new Error("item '" + desc + "' needs a price of 0 or more");
    return { desc: desc, qty: qty, price_minor: Math.round(price) };
  }

  function normPayment(raw, code) {
    if (!raw || typeof raw !== "object") throw new Error("payment is not an object");
    var amount = Number(raw.amount_minor);
    if (!isFinite(amount) || amount <= 0) throw new Error("a payment needs an amount above 0");
    var date = isDateStr(raw.date) ? raw.date : todayStr();
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid("pay"),
      date: date,
      amount_minor: Math.round(amount),
      note: String(raw.note == null ? "" : raw.note)
    };
  }

  function normInvoice(raw) {
    if (!raw || typeof raw !== "object") throw new Error("invoice is not an object");
    var client = String(raw.client == null ? "" : raw.client).trim();
    if (!client) throw new Error("an invoice needs a client name");
    var items = (raw.items || []).map(normItem);
    if (items.length === 0) throw new Error("an invoice needs at least one item");
    var code = currencyInfo(raw.currency).code;
    var inv = {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid("inv"),
      number: String(raw.number == null ? "" : raw.number).trim(),
      client: client,
      currency: code,
      issued: isDateStr(raw.issued) ? raw.issued : todayStr(),
      due: isDateStr(raw.due) ? raw.due : todayStr(),
      notes: String(raw.notes == null ? "" : raw.notes),
      sent: raw.sent === true,
      archived: raw.archived === true,
      items: items,
      payments: (raw.payments || []).map(function (p) { return normPayment(p, code); })
    };
    return inv;
  }

  /* Sorting for the list view: unpaid by due date first, paid at the bottom,
     newest invoice number first inside the paid group. */
  function sortForList(invoices, today) {
    today = today || todayStr();
    return invoices.slice().sort(function (a, b) {
      var sa = statusOf(a, today), sb = statusOf(b, today);
      var ap = sa.status === "paid" ? 1 : 0;
      var bp = sb.status === "paid" ? 1 : 0;
      if (ap !== bp) return ap - bp;
      if (ap === 0 && a.due !== b.due) return a.due < b.due ? -1 : 1;
      return (b.number || "").localeCompare(a.number || "");
    });
  }

  /* ---------- serialization ---------- */

  function exportJSON(store) {
    return JSON.stringify({
      app: APP,
      version: STORE_VERSION,
      exported_at: new Date().toISOString(),
      invoices: store.invoices
    }, null, 2) + "\n";
  }

  function csvCell(v) {
    v = String(v == null ? "" : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function invoicesCSV(store, today) {
    var rows = [["number", "client", "currency", "issued", "due", "status",
                 "total", "paid", "outstanding"]];
    sortForList(store.invoices.filter(function (i) { return !i.archived; }), today)
      .forEach(function (inv) {
        var t = totals(inv);
        var s = statusOf(inv, today);
        var st = s.status + (s.overdue ? " (overdue)" : "");
        rows.push([inv.number, inv.client, inv.currency, inv.issued, inv.due, st,
                   (t.total / Math.pow(10, currencyInfo(inv.currency).decimals)),
                   (t.paid / Math.pow(10, currencyInfo(inv.currency).decimals)),
                   (t.outstanding / Math.pow(10, currencyInfo(inv.currency).decimals))]);
      });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
  }

  function paymentsCSV(store) {
    var rows = [["invoice_number", "client", "date", "amount", "currency", "note"]];
    store.invoices.forEach(function (inv) {
      (inv.payments || []).forEach(function (p) {
        rows.push([inv.number, inv.client, p.date,
                   (p.amount_minor / Math.pow(10, currencyInfo(inv.currency).decimals)),
                   inv.currency, p.note]);
      });
    });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
  }

  /* Import: parse a tagih JSON backup, return normalized invoices.
     Never mutates; the caller merges. */
  function parseImport(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error("that file is not valid JSON"); }
    var list = data && Array.isArray(data.invoices) ? data.invoices
             : Array.isArray(data) ? data : null;
    if (!list) throw new Error("that JSON is not a tagih backup (no invoices array)");
    return list.map(normInvoice);
  }

  /* Merge imported invoices into the store; an id that already exists gets a
     fresh one so imports never overwrite existing records. Returns count. */
  function mergeImport(store, imported) {
    var seen = {};
    store.invoices.forEach(function (i) { seen[i.id] = true; });
    imported.forEach(function (inv) {
      while (seen[inv.id]) inv.id = uid("inv");
      seen[inv.id] = true;
      store.invoices.push(inv);
    });
    return imported.length;
  }

  return {
    APP: APP,
    STORE_VERSION: STORE_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    CURRENCIES: CURRENCIES,
    currencyInfo: currencyInfo,
    todayStr: todayStr,
    isDateStr: isDateStr,
    daysBetween: daysBetween,
    toMinor: toMinor,
    lineTotalMinor: lineTotalMinor,
    totals: totals,
    statusOf: statusOf,
    formatMoney: formatMoney,
    uid: uid,
    nextInvoiceNumber: nextInvoiceNumber,
    emptyStore: emptyStore,
    normInvoice: normInvoice,
    normPayment: normPayment,
    sortForList: sortForList,
    exportJSON: exportJSON,
    invoicesCSV: invoicesCSV,
    paymentsCSV: paymentsCSV,
    parseImport: parseImport,
    mergeImport: mergeImport
  };
});
