// lib/migrate-account-id.js
// One-time migration: rename holdings.account_name and cash_flows.account_name to
// account_number, splitting each value via account-id.splitAccountField and
// populating the new account_aliases table. Idempotent. Wraps work in a transaction.

const { splitAccountField } = require("./account-id");

function tableHasColumn(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function ensureAliasTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_aliases (
      account_number TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function validateAll(db) {
  const bad = [];
  if (tableHasColumn(db, "holdings", "account_name")) {
    const rows = db.prepare("SELECT DISTINCT account_name FROM holdings").all();
    for (const r of rows) {
      try { splitAccountField(r.account_name); }
      catch { bad.push({ table: "holdings", value: r.account_name }); }
    }
  }
  if (tableHasColumn(db, "cash_flows", "account_name")) {
    const rows = db.prepare("SELECT DISTINCT account_name FROM cash_flows").all();
    for (const r of rows) {
      try { splitAccountField(r.account_name); }
      catch { bad.push({ table: "cash_flows", value: r.account_name }); }
    }
  }
  if (bad.length > 0) {
    const list = bad.map((b) => `${b.table}: "${b.value}"`).join(", ");
    throw new Error(`malformed account_name values found — fix these rows before re-running: ${list}`);
  }
}

function rewriteHoldings(db) {
  if (!tableHasColumn(db, "holdings", "account_name")) return 0;
  db.exec(`DROP TABLE IF EXISTS holdings__new;`);
  // Collect all rows first so no read cursor is open during DDL
  const rows = db.prepare("SELECT id, as_of_date, upload_timestamp, account_name, symbol, name, product_type, total_value FROM holdings").all();
  db.exec(`
    CREATE TABLE holdings__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT NOT NULL,
      upload_timestamp TEXT NOT NULL,
      account_number TEXT NOT NULL,
      symbol TEXT, name TEXT, product_type TEXT,
      total_value REAL NOT NULL
    );
  `);
  const insert = db.prepare(`INSERT INTO holdings__new
    (id, as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertAlias = db.prepare(`INSERT INTO account_aliases (account_number, nickname) VALUES (?, ?)
    ON CONFLICT(account_number) DO UPDATE SET nickname = excluded.nickname`);
  let n = 0;
  for (const r of rows) {
    const { accountNumber, nickname } = splitAccountField(r.account_name);
    upsertAlias.run(accountNumber, nickname);
    insert.run(r.id, r.as_of_date, r.upload_timestamp, accountNumber, r.symbol, r.name, r.product_type, r.total_value);
    n++;
  }
  db.exec(`
    DROP TABLE holdings;
    ALTER TABLE holdings__new RENAME TO holdings;
    CREATE UNIQUE INDEX IF NOT EXISTS holdings_uniq
      ON holdings (as_of_date, account_number, COALESCE(symbol, ''), COALESCE(name, ''));
  `);
  return n;
}

function rewriteCashFlows(db) {
  if (!tableHasColumn(db, "cash_flows", "account_name")) return 0;
  db.exec(`DROP TABLE IF EXISTS cash_flows__new;`);
  // Collect all rows first so no read cursor is open during DDL
  const rows = db.prepare("SELECT * FROM cash_flows").all();
  db.exec(`
    CREATE TABLE cash_flows__new (
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
  const insert = db.prepare(`INSERT INTO cash_flows__new
    (id, date, account_number, amount_cad, amount_original, currency_original, fx_rate, activity, description, classification, source_upload_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const upsertAlias = db.prepare(`INSERT INTO account_aliases (account_number, nickname) VALUES (?, ?)
    ON CONFLICT(account_number) DO UPDATE SET nickname = excluded.nickname`);
  let n = 0;
  for (const r of rows) {
    const { accountNumber, nickname } = splitAccountField(r.account_name);
    upsertAlias.run(accountNumber, nickname);
    insert.run(r.id, r.date, accountNumber, r.amount_cad, r.amount_original, r.currency_original,
      r.fx_rate, r.activity, r.description, r.classification, r.source_upload_timestamp);
    n++;
  }
  db.exec(`
    DROP TABLE cash_flows;
    ALTER TABLE cash_flows__new RENAME TO cash_flows;
  `);
  return n;
}

function migrateAccountId(db) {
  ensureAliasTable(db);

  const holdingsHasOld = tableHasColumn(db, "holdings", "account_name");
  const cashHasOld     = tableHasColumn(db, "cash_flows", "account_name");
  if (!holdingsHasOld && !cashHasOld) {
    return { holdingsMigrated: 0, cashFlowsMigrated: 0, aliasesWritten: 0, alreadyMigrated: true };
  }

  validateAll(db);

  const aliasCountBefore = db.prepare("SELECT COUNT(*) AS n FROM account_aliases").get().n;
  const run = db.transaction(() => {
    const h = rewriteHoldings(db);
    const c = rewriteCashFlows(db);
    return { h, c };
  });
  const { h, c } = run();
  const aliasCountAfter = db.prepare("SELECT COUNT(*) AS n FROM account_aliases").get().n;

  return {
    holdingsMigrated: h,
    cashFlowsMigrated: c,
    aliasesWritten: aliasCountAfter - aliasCountBefore,
    alreadyMigrated: false,
  };
}

module.exports = { migrateAccountId };
