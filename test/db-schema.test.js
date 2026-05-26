// test/db-schema.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

test("db.js creates uploaded_files and cash_flows tables with expected columns", () => {
  // Open db.js against a temp working directory so we don't touch the real DB.
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-"));
  process.chdir(tmp);
  try {
    // Re-require fresh to re-run schema against the temp investments.db.
    delete require.cache[require.resolve("../db")];
    const { db } = require("../db");

    const uploadedCols = db.prepare("PRAGMA table_info(uploaded_files)").all().map((c) => c.name);
    assert.deepEqual(uploadedCols.sort(), [
      "archive_path",
      "csv_type",
      "original_filename",
      "row_count_inserted",
      "row_count_skipped",
      "upload_timestamp",
    ]);

    const cashCols = db.prepare("PRAGMA table_info(cash_flows)").all().map((c) => c.name);
    assert.deepEqual(cashCols.sort(), [
      "account_number",
      "activity",
      "amount_cad",
      "amount_original",
      "classification",
      "currency_original",
      "date",
      "description",
      "fx_rate",
      "id",
      "source_upload_timestamp",
    ]);

    // Verify the UNIQUE index on (date, account_number, amount_original, description).
    const indexes = db.prepare("PRAGMA index_list(cash_flows)").all();
    assert.ok(indexes.some((i) => i.unique === 1), "must have a UNIQUE index");
    db.close();
  } finally {
    process.chdir(cwd);
    delete require.cache[require.resolve("../db")];
  }
});

test("holdings_uniq unique index exists on (as_of_date, account_number, symbol/name)", () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-uniq-"));
  process.chdir(tmp);
  try {
    delete require.cache[require.resolve("../db")];
    const { db } = require("../db");
    const indexes = db.prepare("PRAGMA index_list(holdings)").all();
    assert.ok(
      indexes.some((i) => i.name === "holdings_uniq" && i.unique === 1),
      "expected holdings_uniq UNIQUE index"
    );
    db.close();
  } finally {
    process.chdir(cwd);
    delete require.cache[require.resolve("../db")];
  }
});

test("account_aliases table has expected columns", () => {
  const cwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-test-alias-"));
  process.chdir(tmp);
  try {
    delete require.cache[require.resolve("../db")];
    const { db } = require("../db");
    const cols = db.prepare("PRAGMA table_info(account_aliases)").all().map((c) => c.name);
    assert.deepEqual(cols.sort(), ["account_number", "created_at", "nickname"]);
    db.close();
  } finally {
    process.chdir(cwd);
    delete require.cache[require.resolve("../db")];
  }
});
