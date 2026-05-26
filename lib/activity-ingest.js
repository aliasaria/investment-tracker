// lib/activity-ingest.js
// Parses and inserts rows from an "Activity" CSV. Per-row parse failures are skipped
// and counted; the upload itself does not fail. See spec §3 and §4.

const { classifyActivity } = require("./classify");
const { parseFxRateFromDescription, getUsdCadRateForDate } = require("./fx");
const { splitAccountField } = require("./account-id");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (ISO_DATE.test(s)) return s;
  const m = s.match(US_DATE);
  if (m) {
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function pickDate(row) {
  return normalizeDate(row["Date"]) || normalizeDate(row["Settlement Date"]);
}

function parseAmount(raw) {
  if (raw == null || raw === "") return NaN;
  return parseFloat(String(raw).replace(/,/g, ""));
}

async function ingestActivity({ rows, uploadTimestamp, db, yahooFinance }) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO cash_flows
      (date, account_number, amount_cad, amount_original, currency_original,
       fx_rate, activity, description, classification, source_upload_timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const upsertAlias = db.prepare(`
    INSERT INTO account_aliases (account_number, nickname) VALUES (?, ?)
    ON CONFLICT(account_number) DO UPDATE SET nickname = excluded.nickname
  `);

  let inserted = 0;
  let skipped = 0;

  // Pre-resolve FX rates outside the DB transaction (they may hit the network).
  const prepared = [];
  for (const row of rows) {
    const date = pickDate(row);
    let split;
    try {
      split = splitAccountField(row["Account"]);
    } catch {
      skipped++;
      continue;
    }
    const amount = parseAmount(row["Value"]);
    const currency = String(row["Currency"] || "").trim().toUpperCase();
    const activity = String(row["Activity"] || "").trim();
    const description = String(row["Description"] || "").trim();

    if (!date || isNaN(amount) || !(currency === "CAD" || currency === "USD")) {
      skipped++;
      continue;
    }

    let fxRate = null;
    let amountCad = amount;
    if (currency === "USD") {
      fxRate = parseFxRateFromDescription(description);
      if (fxRate == null) {
        try {
          fxRate = await getUsdCadRateForDate(date, { yahooFinance });
          // Yahoo USDCAD=X gives CAD per USD (≈1.36), so amount_cad = amount_usd * rate.
          amountCad = amount * fxRate;
        } catch (err) {
          console.warn(`FX fallback failed for ${date}: ${err.message}`);
          skipped++;
          continue;
        }
      } else {
        // Broker descriptions give USD->CAD as a fraction <1 (USD-per-CAD inverse),
        // i.e. CAD = USD / rate. Verified against sample data: -8988.65 USD @0.733 ≈ -12263 CAD.
        amountCad = amount / fxRate;
      }
    }

    prepared.push({
      date,
      accountNumber: split.accountNumber,
      nickname: split.nickname,
      amountCad, amount, currency, fxRate, activity, description,
      classification: classifyActivity({ activity, description }),
    });
  }

  const insertMany = db.transaction((preps) => {
    for (const p of preps) {
      upsertAlias.run(p.accountNumber, p.nickname);
      const info = insertStmt.run(
        p.date, p.accountNumber, p.amountCad, p.amount, p.currency,
        p.fxRate, p.activity, p.description, p.classification, uploadTimestamp,
      );
      if (info.changes === 1) inserted++;
      else skipped++; // duplicate per UNIQUE constraint
    }
  });
  insertMany(prepared);

  return { inserted, skipped };
}

module.exports = { ingestActivity };
