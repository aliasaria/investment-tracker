// lib/holdings-ingest.js
// Insert parsed holdings rows. Mirrors the original behavior in server.js: every row
// gets as_of_date = upload date (YYYY-MM-DD from uploadTimestamp), invalid rows skipped.

// Picks the CAD total-value field from a row. The original export had a plain "Total Value"
// column already in CAD. A newer variant splits it into "Total Value(in Settlement)" (mixed
// currency per position) and "Total Value(in CAD)" (the right one for us). We prefer the
// explicit CAD column; if neither is present, we return undefined and the row is skipped.
//
// Column names in the variant file contain irregular whitespace (e.g. "Total Value (in  CAD)"
// with a space before the paren and a double space inside). We normalize all runs of whitespace
// to a single space before matching so we're robust to formatting drift.
function pickTotalValueCad(row) {
  // Build a normalized-key → original-value map once per call (rows are plain objects, cheap).
  const normalized = {};
  for (const key of Object.keys(row)) {
    const nk = key.replace(/\s+/g, " ").trim();
    if (normalized[nk] === undefined) normalized[nk] = row[key];
  }
  // Preference 1: explicit CAD total — normalized form "Total Value (in CAD)"
  const cadVal = normalized["Total Value (in CAD)"];
  if (cadVal != null && cadVal !== "") return cadVal;
  // Preference 2: plain "Total Value" column (original format, already CAD)
  const plainVal = normalized["Total Value"];
  if (plainVal != null && plainVal !== "") return plainVal;
  return undefined;
}

function ingestHoldings({ rows, uploadTimestamp, db }) {
  const asOfDate = uploadTimestamp.slice(0, 10);

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO holdings (as_of_date, upload_timestamp, account_name, symbol, name, product_type, total_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  let skipped = 0;

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const accountName = row["Account"];
      const totalValueRaw = pickTotalValueCad(row);
      const totalValue = totalValueRaw != null
        ? parseFloat(String(totalValueRaw).replace(/,/g, ""))
        : NaN;

      if (accountName && !isNaN(totalValue)) {
        const info = insertStmt.run(
          asOfDate,
          uploadTimestamp,
          accountName,
          row["Symbol"],
          row["Name"],
          row["Product Type"],
          totalValue,
        );
        if (info.changes === 1) inserted++;
        else skipped++; // duplicate per UNIQUE constraint
      } else {
        skipped++;
      }
    }
  });

  insertMany(rows);
  return { inserted, skipped };
}

module.exports = { ingestHoldings };
