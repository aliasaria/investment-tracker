// test/classify.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classifyActivity } = require("../lib/classify");

const cases = [
  {
    name: "WHD prefix is external_out",
    activity: "Withdrawals & De-Registrations",
    description: "WHD - 12263.22(u$ To C$ @0.733)",
    expected: "external_out",
  },
  {
    name: "WIR prefix is external_out",
    activity: "Withdrawals & De-Registrations",
    description: "WIR - Wire Transfer Payee Test Payee",
    expected: "external_out",
  },
  {
    name: "EFT prefix is external_out",
    activity: "Withdrawals & De-Registrations",
    description: "EFT - Eft to External Bank",
    expected: "external_out",
  },
  {
    name: "PAY (RRIF retirement payment) is external_out",
    activity: "Withdrawals & De-Registrations",
    description: "PAY - Rrif Payment",
    expected: "external_out",
  },
  {
    name: "CSP (RSP spousal contribution) is internal_transfer",
    activity: "Withdrawals & De-Registrations",
    description: "CSP - Rsp Spousal Contribution To Account 100-00001-01 J",
    expected: "internal_transfer",
  },
  {
    name: "CON (TFSA contribution) is internal_transfer",
    activity: "Withdrawals & De-Registrations",
    description: "CON - Tfsa Contribution To Account 200-00002-02 J",
    expected: "internal_transfer",
  },
  {
    name: "Deposits & Contributions are external_in",
    activity: "Deposits & Contributions",
    description: "DEP - whatever",
    expected: "external_in",
  },
  {
    name: "Dividends are income (not cash flow)",
    activity: "Dividends",
    description: "DIV - Sample Corp Cash Div",
    expected: "income",
  },
  {
    name: "Interest is income",
    activity: "Interest",
    description: "INT - whatever",
    expected: "income",
  },
  {
    name: "Buy activity is 'trade'",
    activity: "Buy",
    description: "anything",
    expected: "trade",
  },
  {
    name: "Sell activity is 'trade'",
    activity: "Sell",
    description: "anything",
    expected: "trade",
  },
  {
    name: "Unknown activity is 'other'",
    activity: "Mystery Corporate Action",
    description: "weird thing",
    expected: "other",
  },
  {
    name: "Unknown description prefix under Withdrawals is 'other'",
    activity: "Withdrawals & De-Registrations",
    description: "XYZ - something we have not seen",
    expected: "other",
  },
  {
    name: "Fees activity is external_out",
    activity: "Fees",
    description: "FCH - Managed Account Fee As Of 01/31/26",
    expected: "external_out",
  },
  {
    name: "Taxes activity is external_out",
    activity: "Taxes",
    description: "HST - Managed Account Fee As Of 01/31/26",
    expected: "external_out",
  },
  {
    name: "Distribution activity is income (fund distributions)",
    activity: "Distribution",
    description: "Sample Fund Units Dist",
    expected: "income",
  },
  {
    name: "Return of Capital activity is income",
    activity: "Return of Capital",
    description: "RTC - Return of Capital",
    expected: "income",
  },
  {
    name: "Literal 'Other' activity (bond maturity) is income",
    activity: "Other",
    description: "TEN - Sample Corp Series Cl Notes Due 04/01/2043",
    expected: "income",
  },
  {
    name: "Transfers TFO (inter-account) is internal_transfer",
    activity: "Transfers",
    description: "TFO - Account Transfer To Account 300-00003-03",
    expected: "internal_transfer",
  },
  {
    name: "Transfers TFI (inter-account) is internal_transfer",
    activity: "Transfers",
    description: "TFI - Account Transfer From Account 400-00004-04",
    expected: "internal_transfer",
  },
  {
    name: "Transfers TF6 (intra-account FX) is fx",
    activity: "Transfers",
    description: "TF6 - 33022.56(u$ To C$ @0.7254)",
    expected: "fx",
  },
  {
    name: "Transfers TRF (foreign exchange) is fx",
    activity: "Transfers",
    description: "TRF - Foreign Exchange To C$ 9,621.04 @ 1.3748",
    expected: "fx",
  },
  {
    name: "Reorganization stays as 'other' (rare corporate actions)",
    activity: "Reorganization",
    description: "CIL - some corporate action",
    expected: "other",
  },
];

for (const c of cases) {
  test(c.name, () => {
    assert.equal(
      classifyActivity({ activity: c.activity, description: c.description }),
      c.expected,
    );
  });
}
