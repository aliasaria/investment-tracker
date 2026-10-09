// lib/account-merges.js
// Lets two broker account numbers be treated as one account. Brokers sometimes
// re-open an account under a new number; merging the old number into the new
// one makes charts, filters, and per-account simulation see a single
// continuous history.
//
// Merges are a pure mapping (account_merges.account_number -> merged_into);
// holdings and cash_flows rows are never rewritten, so a merge is reversible
// and future uploads under either number fold in automatically. The mapping is
// kept flat: merged_into is always a canonical (unmerged) account.

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS account_merges (
    account_number TEXT PRIMARY KEY,
    merged_into TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

function ensureSchema(db) {
  db.exec(SCHEMA_SQL);
}

// SQL expression for the canonical account of a row, given the alias of the
// row's table and of a `LEFT JOIN account_merges <m> ON <m>.account_number = <t>.account_number`.
function canonicalExpr(tableAlias, mergeAlias = "m") {
  return `COALESCE(${mergeAlias}.merged_into, ${tableAlias}.account_number)`;
}

function listMerges(db) {
  return db.prepare("SELECT account_number, merged_into, created_at FROM account_merges ORDER BY merged_into, account_number").all();
}

function canonicalOf(db, accountNumber) {
  const row = db.prepare("SELECT merged_into FROM account_merges WHERE account_number = ?").get(accountNumber);
  return row ? row.merged_into : accountNumber;
}

// All raw account numbers that resolve to the given canonical account
// (including itself).
function membersOf(db, canonical) {
  const merged = db.prepare("SELECT account_number FROM account_merges WHERE merged_into = ?")
    .all(canonical).map((r) => r.account_number);
  return [canonical, ...merged];
}

// Merge `from` into `into`. If `into` is itself merged, resolves to its
// canonical target. Anything previously merged into `from` is re-pointed so
// the mapping stays one level deep.
function mergeAccounts(db, from, into) {
  from = String(from || "").trim();
  into = String(into || "").trim();
  if (!from || !into) throw new Error("both account numbers are required");
  const target = canonicalOf(db, into);
  if (target === from) throw new Error("cannot merge an account into itself");

  db.transaction(() => {
    db.prepare("UPDATE account_merges SET merged_into = ? WHERE merged_into = ?").run(target, from);
    db.prepare(`
      INSERT INTO account_merges (account_number, merged_into) VALUES (?, ?)
      ON CONFLICT(account_number) DO UPDATE SET merged_into = excluded.merged_into
    `).run(from, target);
  })();
  return { account_number: from, merged_into: target };
}

function unmergeAccount(db, accountNumber) {
  return db.prepare("DELETE FROM account_merges WHERE account_number = ?").run(accountNumber).changes > 0;
}

module.exports = {
  ensureSchema, canonicalExpr, listMerges, canonicalOf, membersOf, mergeAccounts, unmergeAccount,
};
