const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { normalizeAccountIds, planChanges } = require("../lib/normalize-account-id");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT NOT NULL, upload_timestamp TEXT NOT NULL,
      account_number TEXT NOT NULL, symbol TEXT, name TEXT,
      product_type TEXT, total_value REAL NOT NULL
    );
    CREATE UNIQUE INDEX holdings_uniq ON holdings (as_of_date, account_number, COALESCE(symbol, ''), COALESCE(name, ''));
    CREATE TABLE cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, account_number TEXT NOT NULL,
      amount_cad REAL NOT NULL, amount_original REAL NOT NULL,
      currency_original TEXT NOT NULL, fx_rate REAL,
      activity TEXT NOT NULL, description TEXT NOT NULL,
      classification TEXT NOT NULL, source_upload_timestamp TEXT NOT NULL,
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

test("normalizes hyphenated holdings to digit-only-first-8", () => {
  const db = freshDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2025-04-30", "2025-04-30T00:00:00Z", "370-77301-1-9", "AAPL", "Apple", "Common Shares", 1000
  );

  const result = normalizeAccountIds(db);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.mapping, [{ from: "370-77301-1-9", to: "37077301" }]);
  const row = db.prepare("SELECT account_number FROM holdings").get();
  assert.equal(row.account_number, "37077301");
});

test("removes alias row with hyphenated key after normalization", () => {
  const db = freshDb();
  db.prepare("INSERT INTO account_aliases (account_number, nickname) VALUES (?, ?)").run("370-77301-1-9", "Whatever");
  normalizeAccountIds(db);
  const row = db.prepare("SELECT * FROM account_aliases WHERE account_number = '370-77301-1-9'").get();
  assert.equal(row, undefined);
});

test("does not clobber existing normalized-form rows (collision deletes stale)", () => {
  // Stale 'PDF-format' row collides with an existing 'CSV-format' row on the same key.
  const db = freshDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2025-04-30", "2025-04-30T00:00:00Z", "37077301", "AAPL", "Apple", "Common Shares", 1000
  );
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2025-04-30", "2025-04-30T01:00:00Z", "370-77301-1-9", "AAPL", "Apple", "Common Shares", 1000
  );

  normalizeAccountIds(db);
  const rows = db.prepare("SELECT account_number FROM holdings").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_number, "37077301");
});

test("dryRun returns mapping without applying", () => {
  const db = freshDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2025-04-30", "2025-04-30T00:00:00Z", "370-77301-1-9", "AAPL", "Apple", "Common Shares", 1000
  );
  const result = normalizeAccountIds(db, { dryRun: true });
  assert.equal(result.updated, 0);
  assert.equal(result.dryRun, true);
  const row = db.prepare("SELECT account_number FROM holdings").get();
  assert.equal(row.account_number, "370-77301-1-9"); // unchanged
});

test("idempotent — no changes after first run", () => {
  const db = freshDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2025-04-30", "2025-04-30T00:00:00Z", "370-77301-1-9", "AAPL", "Apple", "Common Shares", 1000
  );
  normalizeAccountIds(db);
  const second = normalizeAccountIds(db);
  assert.equal(second.updated, 0);
  assert.equal(second.mapping.length, 0);
});
