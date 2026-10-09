// lib/cashflow-dedupe.js
// The same broker activity can arrive twice: once from a monthly PDF statement
// and once from an Activity CSV. The two sources word descriptions differently
// ("EFT" vs "WIR - Eft"), so the cash_flows UNIQUE index doesn't catch it, and
// external flows get double-counted by the simulator.
//
// A PDF row is a duplicate when an Activity-CSV row has the same account, date,
// and original-currency amount (CAD amounts differ for USD rows: PDFs convert at
// the statement's rate, CSVs at the per-row rate).
//
// Where the CSV has any row for a key, it is treated as authoritative and every
// PDF row with that key is dropped. PDFs can hold the same event more than once
// (overlapping monthly statements; page-break text glued onto a description), so
// pairing 1:1 would leave those copies behind — and wouldn't be idempotent.
// The CSV row is kept — it carries the per-row FX rate (see lib/fx.js).

const DUPLICATE_PDF_ROWS_SQL = `
  SELECT p.id
  FROM cash_flows p
  JOIN uploaded_files pu ON pu.upload_timestamp = p.source_upload_timestamp AND pu.csv_type = 'pdf'
  WHERE EXISTS (
    SELECT 1
    FROM cash_flows a
    JOIN uploaded_files au ON au.upload_timestamp = a.source_upload_timestamp AND au.csv_type = 'activity'
    WHERE a.account_number = p.account_number
      AND a.date = p.date
      AND a.currency_original = p.currency_original
      AND ROUND(a.amount_original, 2) = ROUND(p.amount_original, 2)
  )
`;

function findCrossSourceDuplicates(db) {
  return db.prepare(DUPLICATE_PDF_ROWS_SQL).all().map((r) => r.id);
}

// Deletes PDF-sourced cash_flows rows that duplicate an Activity-CSV row.
// Idempotent; safe to run after every upload regardless of upload order.
function removeCrossSourceDuplicates(db) {
  return db.prepare(`DELETE FROM cash_flows WHERE id IN (${DUPLICATE_PDF_ROWS_SQL})`).run().changes;
}

module.exports = { findCrossSourceDuplicates, removeCrossSourceDuplicates };
