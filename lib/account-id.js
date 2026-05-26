// lib/account-id.js
// Splits the broker's combined "Account" field into a canonical account number
// (the stable ID we store in holdings/cash_flows) and a user-friendly nickname
// (kept in the separate account_aliases table for display).
//
// Broker CSVs format the column as "NNNN - Nickname" (no separators in the
// account number, typically 8 digits). PDFs format the same ID as
// "BBB-NNNNN-S-D" (branch-account-subaccount-checkdigit). normalizeAccountNumber
// folds both into the CSV form: strip non-digits, then take the first 8.

function normalizeAccountNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 8 ? digits.slice(0, 8) : digits;
}

function splitAccountField(raw) {
  if (raw == null) throw new Error("malformed Account field: empty");
  const s = String(raw).trim();
  if (s === "") throw new Error("malformed Account field: empty");
  const idx = s.indexOf(" - ");
  if (idx === -1) throw new Error(`malformed Account field: missing ' - ' separator in "${raw}"`);
  const accountNumber = normalizeAccountNumber(s.slice(0, idx));
  const nickname = s.slice(idx + 3).trim();
  if (!accountNumber || !nickname) {
    throw new Error(`malformed Account field: empty side in "${raw}"`);
  }
  return { accountNumber, nickname };
}

module.exports = { splitAccountField, normalizeAccountNumber };
