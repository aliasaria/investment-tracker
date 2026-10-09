// test/cashflow-dedupe.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { findCrossSourceDuplicates, removeCrossSourceDuplicates } = require("../lib/cashflow-dedupe");

const PDF = "2024-01-01T00:00:00.000Z";
const CSV = "2024-02-01T00:00:00.000Z";

function setupDb(rows) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE uploaded_files (
      upload_timestamp TEXT PRIMARY KEY, original_filename TEXT, archive_path TEXT,
      csv_type TEXT, row_count_inserted INTEGER, row_count_skipped INTEGER
    );
    CREATE TABLE cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT, account_number TEXT, amount_cad REAL, amount_original REAL,
      currency_original TEXT, fx_rate REAL, activity TEXT, description TEXT,
      classification TEXT, source_upload_timestamp TEXT
    );
    INSERT INTO uploaded_files VALUES ('${PDF}', 'statement.pdf', '', 'pdf', 0, 0);
    INSERT INTO uploaded_files VALUES ('${CSV}', 'activity.csv', '', 'activity', 0, 0);
  `);
  const ins = db.prepare(`INSERT INTO cash_flows
    (date, account_number, amount_cad, amount_original, currency_original, activity, description, classification, source_upload_timestamp)
    VALUES (?, ?, ?, ?, ?, '', ?, 'external_out', ?)`);
  for (const r of rows) {
    ins.run(r.date, r.account || "A", r.cad ?? r.amount, r.amount, r.currency || "CAD", r.desc || "", r.src);
  }
  return db;
}

const remaining = (db) => db.prepare(`
  SELECT c.description, u.csv_type AS src FROM cash_flows c
  JOIN uploaded_files u ON u.upload_timestamp = c.source_upload_timestamp ORDER BY c.id
`).all().map((r) => `${r.src}:${r.description}`);

test("removes the PDF copy of a row that also came from an Activity CSV", () => {
  const db = setupDb([
    { date: "2024-07-19", amount: -500, desc: "EFT", src: PDF },
    { date: "2024-07-19", amount: -500, desc: "WIR - Eft", src: CSV },
  ]);
  assert.equal(removeCrossSourceDuplicates(db), 1);
  assert.deepEqual(remaining(db), ["activity:WIR - Eft"]);
});

test("matches USD rows on original amount even when CAD conversions differ", () => {
  const db = setupDb([
    { date: "2024-03-01", amount: -100, cad: -136.1, currency: "USD", desc: "pdf", src: PDF },
    { date: "2024-03-01", amount: -100, cad: -135.7, currency: "USD", desc: "csv", src: CSV },
  ]);
  assert.equal(removeCrossSourceDuplicates(db), 1);
  assert.deepEqual(remaining(db), ["activity:csv"]);
});

test("keeps PDF rows with no CSV twin (different date, amount, currency, or account)", () => {
  const db = setupDb([
    { date: "2024-03-01", amount: -100, desc: "csv", src: CSV },
    { date: "2024-03-02", amount: -100, desc: "other date", src: PDF },
    { date: "2024-03-01", amount: -101, desc: "other amount", src: PDF },
    { date: "2024-03-01", amount: -100, currency: "USD", desc: "other currency", src: PDF },
    { date: "2024-03-01", amount: -100, account: "B", desc: "other account", src: PDF },
  ]);
  assert.deepEqual(findCrossSourceDuplicates(db), []);
  assert.equal(removeCrossSourceDuplicates(db), 0);
});

test("CSV is authoritative: all PDF copies of a key go, all CSV rows stay", () => {
  // The same trade appearing in two overlapping statements, once with
  // page-footer text glued on, against one CSV row.
  const db = setupDb([
    { date: "2024-05-01", amount: 10, desc: "SAMPLE CORP", src: PDF },
    { date: "2024-05-01", amount: 10, desc: "SAMPLE CORP Head Office Address", src: PDF },
    { date: "2024-05-01", amount: 10, desc: "Sample Corp", src: CSV },
    { date: "2024-05-01", amount: 10, desc: "Sample Corp (2nd lot)", src: CSV },
  ]);
  assert.equal(removeCrossSourceDuplicates(db), 2);
  assert.deepEqual(remaining(db), ["activity:Sample Corp", "activity:Sample Corp (2nd lot)"]);
});

test("is idempotent, including when PDF has more copies than CSV", () => {
  const db = setupDb([
    { date: "2024-07-19", amount: -500, desc: "EFT", src: PDF },
    { date: "2024-07-19", amount: -500, desc: "EFT (dup)", src: PDF },
    { date: "2024-07-19", amount: -500, desc: "EFT (dup 2)", src: PDF },
    { date: "2024-07-19", amount: -500, desc: "WIR - Eft", src: CSV },
  ]);
  assert.equal(removeCrossSourceDuplicates(db), 3);
  assert.equal(removeCrossSourceDuplicates(db), 0);
  assert.deepEqual(remaining(db), ["activity:WIR - Eft"]);
});
