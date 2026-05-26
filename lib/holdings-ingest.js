// lib/holdings-ingest.js
// Insert parsed holdings rows. Mirrors the original behavior in server.js: every row
// gets as_of_date = upload date (YYYY-MM-DD from uploadTimestamp), invalid rows skipped.

const { splitAccountField } = require("./account-id");

function pickTotalValueCad(row) {
  const normalized = {};
  for (const key of Object.keys(row)) {
    const nk = key.replace(/\s+/g, " ").trim();
    if (normalized[nk] === undefined) normalized[nk] = row[key];
  }
  const cadVal = normalized["Total Value (in CAD)"];
  if (cadVal != null && cadVal !== "") return cadVal;
  const plainVal = normalized["Total Value"];
  if (plainVal != null && plainVal !== "") return plainVal;
  return undefined;
}

function ingestHoldings({ rows, uploadTimestamp, db }) {
  const asOfDate = uploadTimestamp.slice(0, 10);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO holdings (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertAlias = db.prepare(`
    INSERT INTO account_aliases (account_number, nickname) VALUES (?, ?)
    ON CONFLICT(account_number) DO UPDATE SET nickname = excluded.nickname
  `);

  let inserted = 0;
  let skipped = 0;

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      let split;
      try {
        split = splitAccountField(row["Account"]);
      } catch {
        skipped++;
        continue;
      }
      const totalValueRaw = pickTotalValueCad(row);
      const totalValue = totalValueRaw != null
        ? parseFloat(String(totalValueRaw).replace(/,/g, ""))
        : NaN;

      if (!isNaN(totalValue)) {
        upsertAlias.run(split.accountNumber, split.nickname);
        const info = insertStmt.run(
          asOfDate,
          uploadTimestamp,
          split.accountNumber,
          row["Symbol"],
          row["Name"],
          row["Product Type"],
          totalValue,
        );
        if (info.changes === 1) inserted++;
        else skipped++;
      } else {
        skipped++;
      }
    }
  });

  insertMany(rows);
  return { inserted, skipped };
}

module.exports = { ingestHoldings };
