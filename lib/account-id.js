// lib/account-id.js
// Splits the broker's combined "Account" field into a canonical account number
// (the stable ID we store in holdings/cash_flows) and a user-friendly nickname
// (kept in the separate account_aliases table for display).
//
// Broker CSVs format this column as "NNNN - Nickname". The account number may
// itself contain hyphens (e.g. "370-77301-1-9"), so we split on the *first*
// " - " (space-dash-space) only.

function splitAccountField(raw) {
  if (raw == null) throw new Error("malformed Account field: empty");
  const s = String(raw).trim();
  if (s === "") throw new Error("malformed Account field: empty");
  const idx = s.indexOf(" - ");
  if (idx === -1) throw new Error(`malformed Account field: missing ' - ' separator in "${raw}"`);
  const accountNumber = s.slice(0, idx).trim();
  const nickname = s.slice(idx + 3).trim();
  if (!accountNumber || !nickname) {
    throw new Error(`malformed Account field: empty side in "${raw}"`);
  }
  return { accountNumber, nickname };
}

module.exports = { splitAccountField };
