// test/cashflow-buckets.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bucketFor } = require("../lib/cashflow-buckets");

const cases = [
  // Deposits
  { name: "external_in is Deposits",
    row: { classification: "external_in", activity: "Deposits & Contributions" },
    expected: "Deposits" },

  // Withdrawals
  { name: "external_out + Withdrawals activity is Withdrawals",
    row: { classification: "external_out", activity: "Withdrawals & De-Registrations" },
    expected: "Withdrawals" },

  // Fees
  { name: "Fees activity is Fees",
    row: { classification: "external_out", activity: "Fees" },
    expected: "Fees" },

  // Taxes
  { name: "Taxes activity is Taxes",
    row: { classification: "external_out", activity: "Taxes" },
    expected: "Taxes" },

  // Income
  { name: "income classification is Dividends/Income",
    row: { classification: "income", activity: "Dividends" },
    expected: "Dividends/Income" },
  { name: "income with Interest activity is Dividends/Income",
    row: { classification: "income", activity: "Interest" },
    expected: "Dividends/Income" },
  { name: "income with Distribution activity is Dividends/Income",
    row: { classification: "income", activity: "Distribution" },
    expected: "Dividends/Income" },

  // Internal transfer
  { name: "internal_transfer classification is Internal transfers",
    row: { classification: "internal_transfer", activity: "Withdrawals & De-Registrations" },
    expected: "Internal transfers" },
  { name: "internal_transfer via Transfers activity is Internal transfers",
    row: { classification: "internal_transfer", activity: "Transfers" },
    expected: "Internal transfers" },

  // FX
  { name: "fx classification is FX",
    row: { classification: "fx", activity: "Transfers" },
    expected: "FX" },

  // Trades
  { name: "trade with Buy is Trades",
    row: { classification: "trade", activity: "Buy" },
    expected: "Trades" },
  { name: "trade with Sell is Trades",
    row: { classification: "trade", activity: "Sell" },
    expected: "Trades" },

  // Other
  { name: "other classification is Other",
    row: { classification: "other", activity: "Reorganization" },
    expected: "Other" },

  // Fallthrough: external_out that is not Fees/Taxes/Withdrawals
  { name: "external_out with unrecognized activity returns null",
    row: { classification: "external_out", activity: "Something Weird" },
    expected: null },

  // Defensive: missing fields
  { name: "missing classification: activity=Fees still buckets as Fees",
    row: { activity: "Fees" },
    expected: "Fees" },
  { name: "missing activity with external_in still buckets",
    row: { classification: "external_in" },
    expected: "Deposits" },
  { name: "null row argument returns null without throwing",
    row: null,
    expected: null },
];

for (const c of cases) {
  test(c.name, () => {
    assert.equal(bucketFor(c.row), c.expected);
  });
}
