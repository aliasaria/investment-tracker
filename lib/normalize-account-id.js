// lib/normalize-account-id.js
// One-time fix-up for data created before account-number normalization was
// applied to the PDF parser. Updates any holdings/cash_flows row whose
// account_number contains a hyphen to the digit-only-first-8 form, and
// removes the now-orphan account_aliases rows that used the hyphenated form.

const { normalizeAccountNumber } = require("./account-id");

function planChanges(db) {
  const stale = db.prepare(`
    SELECT DISTINCT account_number FROM (
      SELECT account_number FROM holdings WHERE account_number LIKE '%-%'
      UNION
      SELECT account_number FROM cash_flows WHERE account_number LIKE '%-%'
      UNION
      SELECT account_number FROM account_aliases WHERE account_number LIKE '%-%'
    )
  `).all();
  return stale.map((r) => ({
    from: r.account_number,
    to: normalizeAccountNumber(r.account_number),
  })).filter((m) => m.from !== m.to);
}

function normalizeAccountIds(db, { dryRun = false } = {}) {
  const mapping = planChanges(db);
  if (mapping.length === 0) {
    return { updated: 0, mapping: [], dryRun };
  }
  if (dryRun) return { updated: 0, mapping, dryRun };

  const updateHoldings = db.prepare("UPDATE OR IGNORE holdings SET account_number = ? WHERE account_number = ?");
  const updateCashFlows = db.prepare("UPDATE OR IGNORE cash_flows SET account_number = ? WHERE account_number = ?");
  const deleteStaleHoldings = db.prepare("DELETE FROM holdings WHERE account_number = ?");
  const deleteStaleCashFlows = db.prepare("DELETE FROM cash_flows WHERE account_number = ?");
  const deleteAlias = db.prepare("DELETE FROM account_aliases WHERE account_number = ?");

  let totalUpdated = 0;
  const run = db.transaction(() => {
    for (const m of mapping) {
      // UPDATE OR IGNORE skips rows that would violate the UNIQUE index (i.e.
      // a normalized-form row already exists for the same date+symbol+name).
      // Those duplicate stale rows are deleted afterwards.
      const h = updateHoldings.run(m.to, m.from);
      const c = updateCashFlows.run(m.to, m.from);
      deleteStaleHoldings.run(m.from);
      deleteStaleCashFlows.run(m.from);
      deleteAlias.run(m.from);
      totalUpdated += h.changes + c.changes;
    }
  });
  run();

  return { updated: totalUpdated, mapping, dryRun: false };
}

module.exports = { normalizeAccountIds, planChanges };
