// test/activity-ingest.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ingestActivity } = require("../lib/activity-ingest");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      account_number TEXT NOT NULL,
      amount_cad REAL NOT NULL,
      amount_original REAL NOT NULL,
      currency_original TEXT NOT NULL,
      fx_rate REAL,
      activity TEXT NOT NULL,
      description TEXT NOT NULL,
      classification TEXT NOT NULL,
      source_upload_timestamp TEXT NOT NULL,
      UNIQUE(date, account_number, amount_original, description)
    );
    CREATE TABLE account_aliases (
      account_number TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

const fakeYahoo = {
  chart: async () => ({ quotes: [{ date: new Date("2024-08-19T20:00:00Z"), close: 1.36 }] }),
};

test("inserts CAD withdrawal with no FX rate", async () => {
  const db = freshDb();
  const rows = [{
    Date: "2024-08-01",
    Activity: "Withdrawals & De-Registrations",
    Symbol: "",
    Quantity: "",
    Price: "",
    Account: "12345678 - Test Account",
    Value: "-4,000.00",
    Currency: "CAD",
    "Settlement Date": "2024-08-01",
    "Product Type": "Cash",
    "Capital/Revenue": "Capital",
    Description: "WIR - Wire Transfer Payee Test Payee",
  }];

  const result = await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 0);

  const row = db.prepare("SELECT * FROM cash_flows").get();
  assert.equal(row.date, "2024-08-01");
  assert.equal(row.amount_original, -4000);
  assert.equal(row.amount_cad, -4000);
  assert.equal(row.currency_original, "CAD");
  assert.equal(row.fx_rate, null);
  assert.equal(row.classification, "external_out");
});

test("converts USD withdrawal using FX rate embedded in description", async () => {
  const db = freshDb();
  const rows = [{
    Date: "2024-08-19",
    Activity: "Withdrawals & De-Registrations",
    Account: "12345678 - Test Account",
    Value: "-8,988.65",
    Currency: "USD",
    "Settlement Date": "2024-08-19",
    Description: "WHD - 12263.22(u$ To C$ @0.733)",
  }];

  const result = await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  assert.equal(result.inserted, 1);

  const row = db.prepare("SELECT * FROM cash_flows").get();
  assert.equal(row.fx_rate, 0.733);
  // -8988.65 USD / 0.733 = -12263.51... CAD (the description gives 12263.22 — broker rounding)
  assert.ok(Math.abs(row.amount_cad - (-8988.65 / 0.733)) < 0.01);
});

test("falls back to Yahoo when USD row has no @rate in description", async () => {
  const db = freshDb();
  const rows = [{
    Date: "2024-08-19",
    Activity: "Dividends",
    Account: "12345678 - Test Account",
    Value: "32.92",
    Currency: "USD",
    "Settlement Date": "2024-08-19",
    Description: "DIV - Sample Corp Cash Div",
  }];

  const result = await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  assert.equal(result.inserted, 1);

  const row = db.prepare("SELECT * FROM cash_flows").get();
  assert.equal(row.fx_rate, 1.36);
  assert.ok(Math.abs(row.amount_cad - 32.92 * 1.36) < 0.01);
  assert.equal(row.classification, "income");
});

test("parses MM/DD/YYYY date format", async () => {
  const db = freshDb();
  const rows = [{
    Date: "03/02/2026",
    Activity: "Dividends",
    Account: "12345678 - Test Account",
    Value: "32.92",
    Currency: "USD",
    "Settlement Date": "2026-03-02",
    Description: "DIV - whatever",
  }];

  await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });

  const row = db.prepare("SELECT date FROM cash_flows").get();
  assert.equal(row.date, "2026-03-02");
});

test("falls back to Settlement Date when Date is unparseable", async () => {
  const db = freshDb();
  const rows = [{
    Date: "garbage",
    Activity: "Withdrawals & De-Registrations",
    Account: "99999999 - Single",
    Value: "-1,000.00",
    Currency: "CAD",
    "Settlement Date": "2024-01-15",
    Description: "WIR - test",
  }];

  await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  const row = db.prepare("SELECT date FROM cash_flows").get();
  assert.equal(row.date, "2024-01-15");
});

test("skips rows with no parseable date and no Settlement Date", async () => {
  const db = freshDb();
  const rows = [{
    Date: "garbage",
    Activity: "Withdrawals & De-Registrations",
    Account: "99999999 - Single",
    Value: "-1,000.00",
    Currency: "CAD",
    "Settlement Date": "",
    Description: "WIR - test",
  }];

  const result = await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
});

test("skips rows with unknown currency", async () => {
  const db = freshDb();
  const rows = [{
    Date: "2024-08-01",
    Activity: "Withdrawals & De-Registrations",
    Account: "99999999 - Single",
    Value: "-1,000.00",
    Currency: "EUR",
    "Settlement Date": "2024-08-01",
    Description: "WIR - test",
  }];

  const result = await ingestActivity({
    rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo,
  });
  assert.equal(result.skipped, 1);
});

test("idempotency: re-ingest of same rows inserts nothing new", async () => {
  const db = freshDb();
  const rows = [{
    Date: "2024-08-01",
    Activity: "Withdrawals & De-Registrations",
    Account: "99999999 - Single",
    Value: "-1,000.00",
    Currency: "CAD",
    "Settlement Date": "2024-08-01",
    Description: "WIR - test",
  }];

  const r1 = await ingestActivity({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo });
  const r2 = await ingestActivity({ rows, uploadTimestamp: "2026-05-25T12:00:00.000Z", db, yahooFinance: fakeYahoo });
  assert.equal(r1.inserted, 1);
  assert.equal(r2.inserted, 0);
  assert.equal(r2.skipped, 1);
});

test("upserts alias on activity ingest too", async () => {
  const db = freshDb();
  const rows = [
    {
      Date: "2026-05-01", Account: "98765 - TFSA - Jane",
      Value: "100.00", Currency: "CAD", Activity: "Deposits",
      Description: "test deposit",
    },
  ];
  const r = await ingestActivity({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db, yahooFinance: fakeYahoo });
  assert.equal(r.inserted, 1);
  const a = db.prepare("SELECT nickname FROM account_aliases WHERE account_number = '98765'").get();
  assert.equal(a.nickname, "TFSA - Jane");
});
