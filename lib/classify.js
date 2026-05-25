// lib/classify.js
// Classifies an activity row into a cash-flow category.
// See docs/superpowers/specs/2026-05-24-portfolio-vs-index-with-cashflows-design.md §4.
//
// Classifications:
//   external_out      - money left the portfolio (withdrawal, wire, EFT, fees, taxes)
//   external_in       - money entered the portfolio (deposits)
//   internal_transfer - between two tracked accounts; whole-portfolio nets to zero, per-account is real
//   income            - dividends, interest, fund distributions, bond maturity, return of capital
//   trade             - intra-portfolio buy/sell; no net cash effect
//   fx                - intra-account currency conversion (CAD <-> USD); paired legs net to zero
//   other             - anything not yet recognized; surfaced in the UI for refinement

const EXTERNAL_OUT_PREFIXES = ["WHD", "WIR", "EFT"];
const INTERNAL_TRANSFER_PREFIXES = ["CSP", "CON"];
const TRANSFERS_INTERNAL_PREFIXES = ["TFO", "TFI"]; // "Account Transfer To/From Account ..."
const TRANSFERS_FX_PREFIXES = ["TF6", "TRF"];       // intra-account FX legs

function descriptionPrefix(description) {
  // Descriptions look like "WHD - 12263.22(u$ ...)" — take the first whitespace-or-dash-delimited uppercase token.
  const trimmed = String(description || "").trim();
  const match = trimmed.match(/^([A-Z0-9]+)\b/);
  return match ? match[1] : "";
}

function classifyActivity({ activity, description }) {
  const a = String(activity || "").trim();
  const prefix = descriptionPrefix(description);

  if (a === "Withdrawals & De-Registrations") {
    if (INTERNAL_TRANSFER_PREFIXES.includes(prefix)) return "internal_transfer";
    if (EXTERNAL_OUT_PREFIXES.includes(prefix)) return "external_out";
    return "other";
  }
  if (a === "Deposits & Contributions") return "external_in";

  // Real outflows the broker debits from your cash balance.
  if (a === "Fees" || a === "Taxes") return "external_out";

  // Income-like: cash that arrives in the account without a contemporaneous external deposit.
  // "Other" here is the broker's literal activity type — observed examples are bond maturity
  // proceeds (e.g. "TEN - Sample Corp Series Cl Notes ... C$916.26 Princ + C$ 9.16 Int").
  if (a === "Dividends" || a === "Interest") return "income";
  if (a === "Distribution" || a === "Return of Capital" || a === "Other") return "income";

  if (a === "Buy" || a === "Sell") return "trade";

  if (a === "Transfers") {
    if (TRANSFERS_INTERNAL_PREFIXES.includes(prefix)) return "internal_transfer";
    if (TRANSFERS_FX_PREFIXES.includes(prefix)) return "fx";
    return "other";
  }

  // Reorganization (corporate actions like stock splits) and anything else stays as 'other'
  // — they're typically small or rare, and we want them visible in the UI panel.
  return "other";
}

module.exports = { classifyActivity };
