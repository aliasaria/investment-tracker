// lib/cashflow-buckets.js
// Maps a cash_flows row's (classification, activity) to a UI-facing bucket name.
//
// Buckets:
//   Deposits, Withdrawals, Fees, Taxes, Dividends/Income,
//   Internal transfers, FX, Trades, Other
//
// Returns null for rows that don't match any bucket — caller is expected to
// log/skip those rather than invent a tenth bucket. In practice this is only
// reachable when an external_out row has an activity that isn't Fees, Taxes,
// or Withdrawals & De-Registrations.

function bucketFor(row) {
  const { classification, activity } = row || {};
  const c = String(classification || "");
  const a = String(activity || "");

  if (c === "external_in") return "Deposits";

  // Fees/Taxes are tagged by activity regardless of classification.
  if (a === "Fees") return "Fees";
  if (a === "Taxes") return "Taxes";

  if (c === "external_out" && a === "Withdrawals & De-Registrations") return "Withdrawals";

  if (c === "income") return "Dividends/Income";
  if (c === "internal_transfer") return "Internal transfers";
  if (c === "fx") return "FX";
  if (c === "trade") return "Trades";
  if (c === "other") return "Other";

  return null;
}

module.exports = { bucketFor };
