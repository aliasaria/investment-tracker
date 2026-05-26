#!/usr/bin/env node
// One-time migration runner. Opens investments.db (must exist next to the project root),
// runs the account-id migration, prints a summary. Idempotent — safe to re-run.
//
// Usage:  node scripts/migrate-account-id.js

const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");
const { migrateAccountId } = require("../lib/migrate-account-id");

const dbPath = path.resolve(process.cwd(), "investments.db");
if (!fs.existsSync(dbPath)) {
  console.error(`No DB at ${dbPath} — nothing to migrate.`);
  process.exit(0);
}

const db = new Database(dbPath);
try {
  const summary = migrateAccountId(db);
  if (summary.alreadyMigrated) {
    console.log("Database already on new schema — no action taken.");
  } else {
    console.log(`Migrated ${summary.holdingsMigrated} holdings rows, ${summary.cashFlowsMigrated} cash_flows rows.`);
    console.log(`Account aliases written: ${summary.aliasesWritten}.`);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
} finally {
  db.close();
}
