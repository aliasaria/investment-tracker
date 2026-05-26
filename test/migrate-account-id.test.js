const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { migrateAccountId } = require("../lib/migrate-account-id");

function legacyDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT NOT NULL,
      upload_timestamp TEXT NOT NULL,
      account_name TEXT NOT NULL,
      symbol TEXT, name TEXT, product_type TEXT,
      total_value REAL NOT NULL
    );
    CREATE UNIQUE INDEX holdings_uniq ON holdings (as_of_date, account_name, COALESCE(symbol, ''), COALESCE(name, ''));
    CREATE TABLE cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      account_name TEXT NOT NULL,
      amount_cad REAL NOT NULL,
      amount_original REAL NOT NULL,
      currency_original TEXT NOT NULL,
      fx_rate REAL,
      activity TEXT NOT NULL,
      description TEXT NOT NULL,
      classification TEXT NOT NULL,
      source_upload_timestamp TEXT NOT NULL,
      UNIQUE(date, account_name, amount_original, description)
    );
  `);
  return db;
}

test("migrates holdings rows: splits account_name, drops old column", () => {
  const db = legacyDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_name, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2026-01-01", "2026-01-01T00:00:00Z", "12345 - Joint", "AAPL", "Apple", "Common Shares", 1000
  );

  const summary = migrateAccountId(db);
  assert.equal(summary.holdingsMigrated, 1);
  assert.equal(summary.cashFlowsMigrated, 0);
  assert.equal(summary.aliasesWritten, 1);

  const row = db.prepare("SELECT account_number FROM holdings").get();
  assert.equal(row.account_number, "12345");

  const alias = db.prepare("SELECT nickname FROM account_aliases WHERE account_number = '12345'").get();
  assert.equal(alias.nickname, "Joint");

  const cols = db.prepare("PRAGMA table_info(holdings)").all().map((c) => c.name);
  assert.ok(cols.includes("account_number"), "new column present");
  assert.ok(!cols.includes("account_name"), "old column removed");
});

test("migrates cash_flows rows", () => {
  const db = legacyDb();
  db.prepare(`INSERT INTO cash_flows
    (date, account_name, amount_cad, amount_original, currency_original, fx_rate, activity, description, classification, source_upload_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "2026-01-15", "98765 - TFSA - Jane", 50, 50, "CAD", null, "Dividends", "ACME div", "income", "2026-01-15T00:00:00Z"
  );

  const summary = migrateAccountId(db);
  assert.equal(summary.cashFlowsMigrated, 1);

  const row = db.prepare("SELECT account_number FROM cash_flows").get();
  assert.equal(row.account_number, "98765");

  const alias = db.prepare("SELECT nickname FROM account_aliases WHERE account_number = '98765'").get();
  assert.equal(alias.nickname, "TFSA - Jane");
});

test("is idempotent — re-running on a migrated DB is a no-op", () => {
  const db = legacyDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_name, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2026-01-01", "2026-01-01T00:00:00Z", "12345 - Joint", "AAPL", "Apple", "Common Shares", 1000
  );
  migrateAccountId(db);
  const second = migrateAccountId(db);
  assert.equal(second.holdingsMigrated, 0);
  assert.equal(second.alreadyMigrated, true);
});

test("throws listing offending rows when any account_name is malformed", () => {
  const db = legacyDb();
  db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_name, symbol, name, product_type, total_value) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "2026-01-01", "2026-01-01T00:00:00Z", "no-dash-here", "AAPL", "Apple", "Common Shares", 1000
  );
  assert.throws(() => migrateAccountId(db), /malformed.*no-dash-here/i);
});
