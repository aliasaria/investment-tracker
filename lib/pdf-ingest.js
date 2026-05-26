// lib/pdf-ingest.js
// Orchestrates the PDF ingest pipeline:
//   buffer → extract text → split sub-statements → parse → DB insert.
//
// USD holdings/activity are converted to CAD using the FX rate printed in the
// CAD sub-statement header. Activities are classified via a PDF-specific
// mapping (PDF activity strings differ from the CSV broker labels handled by
// lib/classify.js).

const { extractPdfText } = require("./pdf-extract");
const { splitSubStatements } = require("./pdf-statement-split");
const { parseStatement } = require("./pdf-statement-parse");

const FX_DESC_RE = /\((?:C|U)\$\s*TO\s*(?:C|U)\$/i;

function classifyPdfActivity({ activity, description }) {
  if (activity === "DIVIDEND" || activity === "INTEREST") return "income";
  if (activity === "FEE" || activity === "HST" || activity === "CHEQUE" || activity === "WIRE TFR") return "external_out";
  if (activity === "SOLD" || activity === "BOUGHT") return "trade";
  if (activity === "WITHDRAW") {
    return FX_DESC_RE.test(description) ? "fx" : "external_out";
  }
  if (activity === "DEPOSIT") {
    return FX_DESC_RE.test(description) ? "fx" : "external_in";
  }
  return "other";
}

function signedAmount({ debit, credit }) {
  // credit > 0 → positive (money in); debit > 0 → negative (money out)
  return credit - debit;
}

function insertHoldings({ db, asOfDate, uploadTimestamp, accountNumber, rows }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO holdings
      (as_of_date, upload_timestamp, account_number, symbol, name, product_type, total_value)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(asOfDate, uploadTimestamp, accountNumber, r.symbol, r.name, r.productType, r.totalValueCad);
      if (info.changes === 1) inserted++;
    }
  });
  run();
  return inserted;
}

function insertActivity({ db, accountNumber, uploadTimestamp, rows }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO cash_flows
      (date, account_number, amount_cad, amount_original, currency_original,
       fx_rate, activity, description, classification, source_upload_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      const info = stmt.run(
        r.date, accountNumber, r.amountCad, r.amountOriginal, r.currency,
        r.fxRate, r.activity, r.description, r.classification, uploadTimestamp,
      );
      if (info.changes === 1) inserted++;
    }
  });
  run();
  return inserted;
}

function ingestPdfText({ text, uploadTimestamp, db }) {
  const subs = splitSubStatements(text);
  const parsed = subs.map((s) => parseStatement(s));
  if (parsed.length === 0) throw new Error("ingestPdfText: no sub-statements found");

  // Single document-level FX rate (found on the CAD side). Used for USD → CAD.
  const fxRate = parsed.find((s) => s.fxRate != null)?.fxRate ?? null;
  const accountNumber = parsed[0].accountNumber;
  const asOfDate = parsed[0].asOfDate;

  let holdingsInserted = 0;
  let activityInserted = 0;

  for (const s of parsed) {
    // USD sub-statement holdings need fxRate to convert to CAD.
    if (s.currency === "USD" && fxRate == null) {
      throw new Error("ingestPdfText: USD sub-statement present but no FX rate found in the document");
    }
    const holdingsCad = s.holdings.map((h) => ({
      ...h,
      totalValueCad: s.currency === "CAD" ? h.totalValue : h.totalValue * fxRate,
    }));
    holdingsInserted += insertHoldings({ db, asOfDate, uploadTimestamp, accountNumber, rows: holdingsCad });

    const activityRows = s.activity.map((a) => {
      const amountOriginal = signedAmount(a);
      const amountCad = s.currency === "CAD" ? amountOriginal : amountOriginal * fxRate;
      return {
        date: a.date,
        amountCad,
        amountOriginal,
        currency: s.currency,
        fxRate: s.currency === "USD" ? fxRate : null,
        activity: a.activity,
        description: a.description,
        classification: classifyPdfActivity({ activity: a.activity, description: a.description }),
      };
    });
    activityInserted += insertActivity({ db, accountNumber, uploadTimestamp, rows: activityRows });
  }

  return { accountNumber, asOfDate, holdingsInserted, activityInserted };
}

async function ingestPdfBuffer({ buffer, uploadTimestamp, db }) {
  const { text } = await extractPdfText(buffer);
  return ingestPdfText({ text, uploadTimestamp, db });
}

module.exports = { ingestPdfText, ingestPdfBuffer, classifyPdfActivity };
