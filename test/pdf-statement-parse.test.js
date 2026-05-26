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
  assert.equal(result.accountNumber, "999-99999-9-9");
  assert.equal(result.asOfDate, "2025-04-30");
  assert.equal(result.currency, "CAD");
  assert.equal(result.fxRate, 1.4);
});

test("parses bond row (no symbol, has footnote)", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  const bond = result.holdings.find((h) => h.name === "ACMECO BOND");
  assert.ok(bond, "expected bond holding");
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
  assert.equal(result.accountNumber, "999-99999-9-9");
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
  assert.equal(result.holdings[0].name, "ACMECO BOND");
});

test("throws on missing account number", () => {
  const text = "CANADIAN DOLLAR\nA + STATEMENT\nno account here";
  assert.throws(() => parseStatement({ currency: "CAD", text }), /account number/i);
});

test("activity field is empty for now (Task 14 will populate it)", () => {
  const result = parseStatement({ currency: "CAD", text: FAKE_CAD });
  assert.deepEqual(result.activity, []);
});
