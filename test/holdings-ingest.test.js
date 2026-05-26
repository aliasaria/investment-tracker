const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ingestHoldings } = require("../lib/holdings-ingest");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT NOT NULL,
      upload_timestamp TEXT NOT NULL,
      account_number TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      product_type TEXT,
      total_value REAL NOT NULL
    );
    CREATE UNIQUE INDEX holdings_uniq ON holdings (as_of_date, account_number, COALESCE(symbol, ''), COALESCE(name, ''));
    CREATE TABLE account_aliases (
      account_number TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

test("inserts holdings rows keyed on account_number, upserts alias", () => {
  const db = freshDb();
  const rows = [
    { Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares", "Total Value": "1,000.00" },
    { Account: "12345 - Joint", Symbol: "GOOG", Name: "Google", "Product Type": "Common Shares", "Total Value": "2,000.00" },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holdings").get().n, 2);
  assert.equal(db.prepare("SELECT account_number FROM holdings LIMIT 1").get().account_number, "12345");
  const alias = db.prepare("SELECT nickname FROM account_aliases WHERE account_number = '12345'").get();
  assert.equal(alias.nickname, "Joint");
});

test("re-ingesting same holdings on same as_of_date inserts nothing (idempotent)", () => {
  const db = freshDb();
  const rows = [
    { Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares", "Total Value": "1,000.00" },
  ];
  const r1 = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  const r2 = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T13:00:00.000Z", db });
  assert.equal(r1.inserted, 1);
  assert.equal(r2.inserted, 0);
  assert.equal(r2.skipped, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holdings").get().n, 1);
});

test("cash rows (NULL symbol but named) dedupe via COALESCE-on-name", () => {
  const db = freshDb();
  const rows = [
    { Account: "12345 - Joint", Symbol: "", Name: "CANADIAN DOLLAR", "Product Type": "Cash", "Total Value": "5,000.00" },
  ];
  const r1 = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  const r2 = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T13:00:00.000Z", db });
  assert.equal(r1.inserted, 1);
  assert.equal(r2.inserted, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM holdings").get().n, 1);
});

test("prefers 'Total Value (in CAD)' over 'Total Value' when both present", () => {
  const db = freshDb();
  const rows = [
    {
      Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares",
      "Total Value": "999.99",
      "Total Value (in CAD)": "1,234.56",
    },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 1);
  assert.equal(db.prepare("SELECT total_value FROM holdings").get().total_value, 1234.56);
});

test("falls back to 'Total Value' when only that column is present", () => {
  const db = freshDb();
  const rows = [
    {
      Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares",
      "Total Value": "1,000.00",
    },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 1);
  assert.equal(db.prepare("SELECT total_value FROM holdings").get().total_value, 1000);
});

test("normalizes irregular whitespace in column names (e.g. 'Total Value (in  CAD)' with double space)", () => {
  const db = freshDb();
  const rows = [
    {
      Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares",
      "Total Value (in  CAD)": "2,500.00",
    },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 1);
  assert.equal(db.prepare("SELECT total_value FROM holdings").get().total_value, 2500);
});

test("skips rows when neither 'Total Value' nor 'Total Value (in CAD)' is present", () => {
  const db = freshDb();
  const rows = [
    {
      Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares",
      "Total Value(in Settlement)": "1,000.00",
    },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 1);
});

test("skips rows with malformed Account field but doesn't crash the upload", () => {
  const db = freshDb();
  const rows = [
    { Account: "12345 - Joint", Symbol: "AAPL", Name: "Apple", "Product Type": "Common Shares", "Total Value": "1,000.00" },
    { Account: "no-dash-here", Symbol: "GOOG", Name: "Google", "Product Type": "Common Shares", "Total Value": "2,000.00" },
  ];
  const result = ingestHoldings({ rows, uploadTimestamp: "2026-05-24T12:00:00.000Z", db });
  assert.equal(result.inserted, 1);
  assert.equal(result.skipped, 1);
});
