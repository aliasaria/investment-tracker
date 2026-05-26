const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseStatement } = require("../lib/pdf-statement-parse");

// All fixtures fabricated. Do NOT replace any value with anything from a real
// statement (PII policy). Numbers, dates, and security names are invented.
const FAKE_CAD = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 5

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )
QUANTITY/ MKT. BOOK MARKET\tSECURITY
SEGREGATED PRICE COST VALUE\tSYMBOL
_________________________________________________________________________________________
FIXED INCOME
ACMECO BOND 1,000 99.500 980.00 $995.00 ¹
DUE 01/01/2030 4.000% JJ 01 1,000
COMMON SHARES
ACME LTD ACME 100 50.000 4,500.00 $5,000.00
COM 100
ANOTHERCO LIMITED ANTHR 50 200.000 9,000.00 $10,000.00
50
FOREIGN SECURITIES
GLOBALCO PARTNERS GBLP 50 20.000 900.00 $1,000.00
LP UNITS 50
Total Value of Foreign Securities 900.00 $1,000.00
_________________________________________________________________________________________
Total Value of All Securities 15,395.00 $16,995.00
ACCOUNT ACTIVITY
...
`;

test("parses CAD sub-statement header", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  assert.equal(result.accountNumber, "99999999");
  assert.equal(result.asOfDate, "2025-04-30");
  assert.equal(result.currency, "CAD");
  assert.equal(result.fxRate, 1.4);
});

test("parses bond row (no symbol, has footnote) — name includes DUE info to disambiguate same-issuer maturities", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  const bond = result.holdings.find((h) => h.name.startsWith("ACMECO BOND"));
  assert.ok(bond, "expected bond holding");
  assert.equal(bond.name, "ACMECO BOND DUE 01/01/2030 4.000%");
  assert.equal(bond.productType, "FIXED INCOME");
  assert.equal(bond.symbol, null);
  assert.equal(bond.totalValue, 995.0);
});

test("parses stock row with symbol", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  const stock = result.holdings.find((h) => h.symbol === "ACME");
  assert.ok(stock, "expected ACME holding");
  assert.equal(stock.name, "ACME LTD");
  assert.equal(stock.productType, "COMMON SHARES");
  assert.equal(stock.totalValue, 5000.0);
});

test("parses second stock row in same section", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  const stock = result.holdings.find((h) => h.symbol === "ANTHR");
  assert.ok(stock, "expected ANTHR holding");
  assert.equal(stock.totalValue, 10000.0);
});

test("foreign-securities section assigns productType correctly", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  const gb = result.holdings.find((h) => h.symbol === "GBLP");
  assert.ok(gb);
  assert.equal(gb.productType, "FOREIGN SECURITIES");
});

test("continuation lines do not produce spurious holdings", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  // 4 holdings expected: ACMECO BOND, ACME LTD, ANOTHERCO LIMITED, GLOBALCO PARTNERS
  assert.equal(result.holdings.length, 4);
});

test("USD sub-statement has fxRate=null (rate is only on the CAD side)", () => {
  const FAKE_USD = `U.S. DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 4

ASSET REVIEW
QUANTITY/ MKT. BOOK MARKET\tSECURITY
SEGREGATED PRICE COST VALUE\tSYMBOL
_________________________________________________________________________________________
COMMON SHARES
USCO INC USCO 10 100.000 900.00 $1,000.00
10
ACCOUNT ACTIVITY
...
`;
  const result = parseStatement({ currency: "USD", text: FAKE_USD });
  assert.equal(result.currency, "USD");
  assert.equal(result.fxRate, null);
  assert.equal(result.accountNumber, "99999999");
  assert.equal(result.holdings.length, 1);
  assert.equal(result.holdings[0].symbol, "USCO");
});

test("skips UNPRICED rows", () => {
  const text = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )
FIXED INCOME
NOPRICE CORP 12,000 UNPRICED 0.01 ²
SR NOTES TEMP
DUE 04/15/2029 3.750% AO 15
ACMECO BOND 1,000 99.500 980.00 $995.00 ¹
DUE 01/01/2030 4.000% JJ 01 1,000
ACCOUNT ACTIVITY
...
`;
  const result = parseStatement({ currency: "CAD", text });
  // Only ACMECO BOND should remain — the UNPRICED row is filtered.
  assert.equal(result.holdings.length, 1);
  assert.equal(result.holdings[0].name, "ACMECO BOND DUE 01/01/2030 4.000%");
});

test("throws on missing account number", () => {
  const text = "CANADIAN DOLLAR\nA + STATEMENT\nno account here";
  assert.throws(() => parseStatement({ currency: "CAD", text }), /account number/i);
});

const FAKE_ACTIVITY = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 5

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )
COMMON SHARES
ACME LTD ACME 100 50.000 4,500.00 $5,000.00
COM 100
ACCOUNT ACTIVITY PRICE
QUANTITY \\RATE DEBIT CREDIT\tDATE ACTIVITY DESCRIPTION
Opening Balance (MAR. 31, 2025) $1,000.00
APR. 01 DIVIDEND ACME LTD 0.500 50.00
CASH DIV ON 100 SHS
REC 03/15/25 PAY 04/01/25
APR. 02 WIRE TFR WIRE TRANSFER 4,000.00
PAYEE
FAKE PERSON
APR. 03 FEE AS OF 04/02/25 25.00
WIRE TRANSFER FEE
APR. 04 INTEREST ACME BOND 220.00
SR UNSECURED
APR. 10 DISTRIB. SOMECO INC 12,000
SENIOR NOTES TEMP
APR. 17 SOLD ACME LTD 10- 45.000 450.00
AVG PRICE SHOWN-DETAILS ON REQ
APR. 17 BOUGHT OTHERCO 5 100.000 500.00
AVG PRICE SHOWN-DETAILS ON REQ
APR. 17 HST HST ON MGMT FEE 100.00
APR. 17 CHEQUE CK # ABC123 999.99
APR. 23 WITHDRAW 1000.00(C$ TO U$ @1.4) 1,400.00
Closing Balance (APR. 30, 2025) $1,000.00
`;

test("parses DIVIDEND row (credit) with rate", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const div = r.activity.find((a) => a.activity === "DIVIDEND");
  assert.ok(div);
  assert.equal(div.date, "2025-04-01");
  assert.equal(div.credit, 50.0);
  assert.equal(div.debit, 0);
  assert.ok(div.description.includes("ACME LTD"));
});

test("parses INTEREST row (credit, no rate)", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const intr = r.activity.find((a) => a.activity === "INTEREST");
  assert.ok(intr);
  assert.equal(intr.credit, 220.0);
});

test("parses WIRE TFR (two-token activity, debit)", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const w = r.activity.find((a) => a.activity === "WIRE TFR");
  assert.ok(w, "expected WIRE TFR row");
  assert.equal(w.debit, 4000.0);
  assert.equal(w.credit, 0);
});

test("parses FEE (debit)", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const fee = r.activity.find((a) => a.activity === "FEE");
  assert.ok(fee);
  assert.equal(fee.debit, 25.0);
});

test("parses SOLD and BOUGHT", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const sold = r.activity.find((a) => a.activity === "SOLD");
  const bought = r.activity.find((a) => a.activity === "BOUGHT");
  assert.equal(sold.credit, 450.0);
  assert.equal(bought.debit, 500.0);
});

test("parses HST (debit) and CHEQUE (debit)", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const hst = r.activity.find((a) => a.activity === "HST");
  const chq = r.activity.find((a) => a.activity === "CHEQUE");
  assert.equal(hst.debit, 100.0);
  assert.equal(chq.debit, 999.99);
});

test("parses WITHDRAW with embedded FX in description", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const w = r.activity.find((a) => a.activity === "WITHDRAW");
  assert.ok(w);
  assert.equal(w.debit, 1400.0);
  assert.ok(w.description.includes("@1.4"));
});

test("DISTRIB. rows are skipped (no $ amount)", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  assert.ok(!r.activity.some((a) => a.activity === "DISTRIB."));
});

test("Opening/Closing balance lines do not become activity rows", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  assert.ok(!r.activity.some((a) => /Opening Balance|Closing Balance/.test(a.description)));
});

test("continuation lines extend the previous row's description, not new rows", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  const div = r.activity.find((a) => a.activity === "DIVIDEND");
  // 'CASH DIV ON 100 SHS' and 'REC 03/15/25 PAY 04/01/25' should be in description
  assert.ok(div.description.includes("CASH DIV ON 100 SHS"));
  assert.ok(div.description.includes("REC 03/15/25"));
});

test("USD dividend with NRT records the NET credit (rightmost numeric)", () => {
  const text = `U.S. DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1

ASSET REVIEW
COMMON SHARES
USCO INC USCO 10 100.000 900.00 $1,000.00
10
ACCOUNT ACTIVITY
Opening Balance (MAR. 31, 2025) $500.00
APR. 02 DIVIDEND USCO INC 0.01 0.38 NRT 2.58
CASH DIV ON 258 SHS
NON-RES TAX WITHHELD
Closing Balance (APR. 30, 2025) $502.58
`;
  const r = parseStatement({ currency: "USD", text });
  const div = r.activity.find((a) => a.activity === "DIVIDEND");
  assert.ok(div);
  assert.equal(div.credit, 2.58);
  assert.equal(div.debit, 0);
});

test("Replace 'activity field is empty for now' expectation now that Task 14 populates it", () => {
  const r = parseStatement({ currency: "CAD", text: FAKE_ACTIVITY });
  // There should be multiple activity rows now (DIVIDEND, WIRE TFR, FEE, INTEREST, SOLD, BOUGHT, HST, CHEQUE, WITHDRAW = 9; DISTRIB. skipped)
  assert.ok(r.activity.length >= 9, `expected >=9 activity rows, got ${r.activity.length}`);
});

test("parses header date with non-dot month formats", () => {
  for (const [token, expectedMonth] of [
    ["MAY 30", "05-30"],
    ["JUNE 30", "06-30"],
    ["JULY 31", "07-31"],
    ["SEPT 30", "09-30"],
    ["MAR. 31", "03-31"],
    ["DEC. 1", "12-01"],
  ]) {
    const text = `CANADIAN DOLLAR
A + STATEMENT
${token}
2025
Your Account Number: 999-99999-9-9
Page 1 of 1
ASSET REVIEW
ACCOUNT ACTIVITY
`;
    const r = parseStatement({ currency: "CAD", text });
    assert.equal(r.asOfDate, `2025-${expectedMonth}`, `failed for token "${token}"`);
  }
});

test("parses activity rows with non-dot month formats (e.g. 'MAY 01')", () => {
  const text = `CANADIAN DOLLAR
A + STATEMENT
MAY 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1
ASSET REVIEW
ACCOUNT ACTIVITY
Opening Balance (APR. 30, 2025) $1,000.00
MAY 01 INTEREST ACME BOND 220.00
SR UNSECURED
Closing Balance (MAY 30, 2025) $1,220.00
`;
  const r = parseStatement({ currency: "CAD", text });
  assert.equal(r.activity.length, 1);
  assert.equal(r.activity[0].date, "2025-05-01");
  assert.equal(r.activity[0].activity, "INTEREST");
  assert.equal(r.activity[0].credit, 220.0);
});

test("ADJUST rows are skipped (book-cost adjustment, no cash impact)", () => {
  const text = `CANADIAN DOLLAR
A + STATEMENT
MAY 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1
ASSET REVIEW
ACCOUNT ACTIVITY
Opening Balance (APR. 30, 2025) $1,000.00
DEC. 31 ADJUST CANADIAN APARTMENT PPTYS
REAL ESTATE INVT TRUST UTS
2024 NOTIONAL DISTRIBUTION
ADJUSTMENT TO BOOK COST
$78.07
MAY 01 INTEREST ACME BOND 220.00
Closing Balance (MAY 30, 2025) $1,220.00
`;
  const r = parseStatement({ currency: "CAD", text });
  // ADJUST row should be skipped; only INTEREST remains.
  assert.equal(r.activity.length, 1);
  assert.equal(r.activity[0].activity, "INTEREST");
});

test("two bonds with same issuer get distinct names via DUE date append", () => {
  const text = `CANADIAN DOLLAR
A + STATEMENT
APR. 30
2025
Your Account Number: 999-99999-9-9
Page 1 of 1

ASSET REVIEW ( Exchange rate 1USD = 1.40000 CAD as of APR. 30, 2025 )
FIXED INCOME
TWINS CORP 5,000 100.000 5,000.00 $5,000.00 ¹
DUE 03/15/2027 4.000% MS 15
TWINS CORP 7,000 99.000 6,930.00 $6,930.00 ¹
DUE 09/01/2030 3.500% MS 01
ACCOUNT ACTIVITY
`;
  const r = parseStatement({ currency: "CAD", text });
  assert.equal(r.holdings.length, 2);
  const names = r.holdings.map((h) => h.name).sort();
  assert.deepEqual(names, [
    "TWINS CORP DUE 03/15/2027 4.000%",
    "TWINS CORP DUE 09/01/2030 3.500%",
  ]);
});
