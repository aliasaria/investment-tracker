const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ingestPdfText } = require("../lib/pdf-ingest");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT NOT NULL,
      upload_timestamp TEXT NOT NULL,
      account_number TEXT NOT NULL,
      symbol TEXT, name TEXT, product_type TEXT,
      total_value REAL NOT NULL
    );
    CREATE UNIQUE INDEX holdings_uniq ON holdings (as_of_date, account_number, COALESCE(symbol, ''), COALESCE(name, ''));
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

// All fixtures fabricated — no PII.
const FAKE_PDF_TEXT = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 5

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )
COMMON SHARES
ACME LTD ACME 100 50.000 4,500.00 $5,000.00
100

ACCOUNT ACTIVITY
Opening Balance (MAR. 31, 2025) $1,000.00
APR. 01 DIVIDEND ACME LTD 0.500 50.00
CASH DIV ON 100 SHS
APR. 03 FEE WIRE TRANSFER FEE 25.00
Closing Balance (APR. 30, 2025) $1,025.00

U.S. DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 3

ASSET REVIEW
COMMON SHARES
USCO INC USCO 10 100.000 900.00 $1,000.00
10

ACCOUNT ACTIVITY
Opening Balance (MAR. 31, 2025) $500.00
APR. 15 DIVIDEND USCO INC 0.10 1.00
CASH DIV ON 10 SHS
Closing Balance (APR. 30, 2025) $501.00
`;

test("ingests both sub-statements; USD holdings converted via fxRate", () => {
  const db = freshDb();
  const summary = ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  assert.equal(summary.accountNumber, "999-99999-9-9");
  assert.equal(summary.asOfDate, "2025-04-30");
  assert.equal(summary.holdingsInserted, 2);
  assert.equal(summary.activityInserted, 3);  // 1 CAD DIV + 1 CAD FEE + 1 USD DIV
  const usco = db.prepare("SELECT total_value FROM holdings WHERE symbol = 'USCO'").get();
  // $1,000 USD * 1.4 = $1,400 CAD
  assert.equal(Math.round(usco.total_value), 1400);
  const acme = db.prepare("SELECT total_value FROM holdings WHERE symbol = 'ACME'").get();
  assert.equal(acme.total_value, 5000);
});

test("USD activity row stores CAD amount via fxRate, plus original USD", () => {
  const db = freshDb();
  ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const usdDiv = db.prepare("SELECT * FROM cash_flows WHERE currency_original = 'USD'").get();
  assert.equal(usdDiv.amount_original, 1.0);
  assert.equal(Math.round(usdDiv.amount_cad * 100) / 100, 1.4);
  assert.equal(usdDiv.fx_rate, 1.4);
  assert.equal(usdDiv.activity, "DIVIDEND");
  assert.equal(usdDiv.classification, "income");
});

test("CAD FEE row classified as external_out with negative amount_cad", () => {
  const db = freshDb();
  ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const fee = db.prepare("SELECT * FROM cash_flows WHERE activity = 'FEE'").get();
  assert.equal(fee.classification, "external_out");
  assert.equal(fee.amount_cad, -25.0);
  assert.equal(fee.currency_original, "CAD");
});

test("CAD DIVIDEND row classified as income with positive amount_cad", () => {
  const db = freshDb();
  ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const div = db.prepare("SELECT * FROM cash_flows WHERE activity = 'DIVIDEND' AND currency_original = 'CAD'").get();
  assert.equal(div.classification, "income");
  assert.equal(div.amount_cad, 50.0);
});

test("re-ingesting the same PDF text is idempotent", () => {
  const db = freshDb();
  const a = ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const b = ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T13:00:00.000Z", db });
  assert.equal(a.holdingsInserted, 2);
  assert.equal(b.holdingsInserted, 0);
  assert.equal(a.activityInserted, 3);
  assert.equal(b.activityInserted, 0);
});

test("WITHDRAW with FX-conversion description classifies as 'fx'", () => {
  const text = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )

ACCOUNT ACTIVITY
Opening Balance (MAR. 31, 2025) $1,000.00
APR. 23 WITHDRAW 1000.00(C$ TO U$ @1.4) 1,400.00
Closing Balance (APR. 30, 2025) $0.00
`;
  const db = freshDb();
  ingestPdfText({ text, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const w = db.prepare("SELECT classification FROM cash_flows WHERE activity = 'WITHDRAW'").get();
  assert.equal(w.classification, "fx");
});

test("no aliases table mutation when PDF doesn't supply a nickname", () => {
  const db = freshDb();
  ingestPdfText({ text: FAKE_PDF_TEXT, uploadTimestamp: "2026-05-26T12:00:00.000Z", db });
  const aliasRow = db.prepare("SELECT * FROM account_aliases WHERE account_number = '999-99999-9-9'").get();
  assert.equal(aliasRow, undefined);
});
