#!/usr/bin/env node
// One-time fix-up: normalize any account_number that still contains a hyphen
// (a PDF-format ID that was inserted before normalization was applied at parse
// time). Idempotent — safe to re-run.
//
// Usage:
//   node scripts/normalize-account-numbers.js            # apply
//   node scripts/normalize-account-numbers.js --dry-run  # report what would change

const Database = require("better-sqlite3");
const path = require("node:path");
const fs = require("node:fs");
const { normalizeAccountIds } = require("../lib/normalize-account-id");

const dryRun = process.argv.includes("--dry-run");
const dbPath = path.resolve(process.cwd(), "investments.db");
if (!fs.existsSync(dbPath)) {
  console.error(`No DB at ${dbPath} — nothing to do.`);
  process.exit(0);
}

const db = new Database(dbPath);
try {
  const result = normalizeAccountIds(db, { dryRun });
  if (result.mapping.length === 0) {
    console.log("No hyphenated account_numbers found — nothing to normalize.");
  } else {
    console.log(`${dryRun ? "Would normalize" : "Normalized"} ${result.mapping.length} account_number value(s):`);
    for (const m of result.mapping) console.log(`  ${m.from} → ${m.to}`);
    if (!dryRun) console.log(`Updated ${result.updated} row(s) across holdings + cash_flows.`);
  }
} finally {
  db.close();
}
