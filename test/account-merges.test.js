// test/account-merges.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  ensureSchema, canonicalExpr, listMerges, canonicalOf, membersOf, mergeAccounts, unmergeAccount,
} = require("../lib/account-merges");

function freshDb() {
  const db = new Database(":memory:");
  ensureSchema(db);
  return db;
}

test("unmerged account is its own canonical and sole member", () => {
  const db = freshDb();
  assert.equal(canonicalOf(db, "A"), "A");
  assert.deepEqual(membersOf(db, "A"), ["A"]);
});

test("mergeAccounts maps old into new", () => {
  const db = freshDb();
  assert.deepEqual(mergeAccounts(db, "OLD", "NEW"), { account_number: "OLD", merged_into: "NEW" });
  assert.equal(canonicalOf(db, "OLD"), "NEW");
  assert.deepEqual(membersOf(db, "NEW").sort(), ["NEW", "OLD"]);
});

test("merging into a merged account resolves to its canonical target", () => {
  const db = freshDb();
  mergeAccounts(db, "B", "C");
  assert.deepEqual(mergeAccounts(db, "A", "B"), { account_number: "A", merged_into: "C" });
});

test("merging a canonical account re-points its members (mapping stays flat)", () => {
  const db = freshDb();
  mergeAccounts(db, "A", "B");
  mergeAccounts(db, "B", "C");
  assert.deepEqual(listMerges(db).map((r) => [r.account_number, r.merged_into]), [["A", "C"], ["B", "C"]]);
});

test("rejects self-merge, including via an existing merge", () => {
  const db = freshDb();
  assert.throws(() => mergeAccounts(db, "A", "A"), /itself/);
  mergeAccounts(db, "A", "B");
  assert.throws(() => mergeAccounts(db, "B", "A"), /itself/);
  assert.throws(() => mergeAccounts(db, "", "B"), /required/);
});

test("unmergeAccount removes the mapping", () => {
  const db = freshDb();
  mergeAccounts(db, "OLD", "NEW");
  assert.equal(unmergeAccount(db, "OLD"), true);
  assert.equal(unmergeAccount(db, "OLD"), false);
  assert.equal(canonicalOf(db, "OLD"), "OLD");
});

test("canonicalExpr folds rows under the canonical account in SQL", () => {
  const db = freshDb();
  db.exec("CREATE TABLE holdings (as_of_date TEXT, account_number TEXT, total_value REAL)");
  const ins = db.prepare("INSERT INTO holdings VALUES (?, ?, ?)");
  ins.run("2024-01-01", "OLD", 100);
  ins.run("2024-02-01", "NEW", 150);
  ins.run("2024-02-01", "OTHER", 5);
  mergeAccounts(db, "OLD", "NEW");
  const rows = db.prepare(`
    SELECT ${canonicalExpr("h")} AS acct, COUNT(*) AS n, SUM(total_value) AS v
    FROM holdings h LEFT JOIN account_merges m ON m.account_number = h.account_number
    GROUP BY acct ORDER BY acct
  `).all();
  assert.deepEqual(rows.map((r) => [r.acct, r.n, r.v]), [["NEW", 2, 250], ["OTHER", 1, 5]]);
});
