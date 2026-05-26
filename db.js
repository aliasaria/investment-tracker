// db.js
// Opens the SQLite database and ensures schema is up to date.
const Database = require("better-sqlite3");

const db = new Database("investments.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    as_of_date TEXT NOT NULL,
    upload_timestamp TEXT NOT NULL,
    account_number TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    product_type TEXT,
    total_value REAL NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS uploaded_files (
    upload_timestamp TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    archive_path TEXT NOT NULL,
    csv_type TEXT NOT NULL,
    row_count_inserted INTEGER NOT NULL,
    row_count_skipped INTEGER NOT NULL DEFAULT 0
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cash_flows (
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
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS holdings_uniq
  ON holdings (as_of_date, account_number, COALESCE(symbol, ''), COALESCE(name, ''));
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS account_aliases (
    account_number TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = { db };
