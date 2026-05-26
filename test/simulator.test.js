// test/simulator.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { simulateIndexPortfolio } = require("../lib/simulator");

function setupDb({ holdings, cashFlows }) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      as_of_date TEXT, upload_timestamp TEXT, account_number TEXT,
      symbol TEXT, name TEXT, product_type TEXT, total_value REAL
    );
    CREATE TABLE cash_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT, account_number TEXT, amount_cad REAL, amount_original REAL,
      currency_original TEXT, fx_rate REAL, activity TEXT, description TEXT,
      classification TEXT, source_upload_timestamp TEXT,
      UNIQUE(date, account_number, amount_original, description)
    );
  `);
  const ih = db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_number, total_value) VALUES (?, '', ?, ?)");
  for (const h of holdings) ih.run(h.date, h.account, h.value);
  const ic = db.prepare(`INSERT INTO cash_flows (date, account_number, amount_cad, amount_original, currency_original, activity, description, classification, source_upload_timestamp)
                         VALUES (?, ?, ?, ?, 'CAD', '', '', ?, '')`);
  for (const c of cashFlows) ic.run(c.date, c.account, c.amount, c.amount, c.classification);
  return db;
}

function makeYahoo(quotesByDate) {
  // quotesByDate: { 'YYYY-MM-DD': closePrice }
  return {
    chart: async () => ({
      quotes: Object.entries(quotesByDate)
        .sort()
        .map(([d, close]) => ({ date: new Date(`${d}T20:00:00Z`), close })),
    }),
  };
}

test("simulator with no cash flows: index portfolio tracks the index ratio", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-06-01", account: "A", value: 0 },
    ],
    cashFlows: [],
  });
  const yahoo = makeYahoo({ "2024-01-01": 100, "2024-06-01": 200 });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Start units: 100000/100 = 1000. End value: 1000 * 200 = 200000.
  assert.equal(result.data[0], "100000.00");
  assert.equal(result.data[result.data.length - 1], "200000.00");
});

test("simulator: $100k start, index doubles, $20k withdrawal at midpoint when index = 1.5x", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-12-31", account: "A", value: 0 },
    ],
    cashFlows: [
      { date: "2024-06-01", account: "A", amount: -20000, classification: "external_out" },
    ],
  });
  const yahoo = makeYahoo({
    "2024-01-01": 100,
    "2024-06-01": 150,
    "2024-12-31": 200,
  });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Units start = 1000. After withdrawal: 1000 - 20000/150 = 1000 - 133.33... = 866.66...
  // End value = 866.66... * 200 = 173333.33
  const end = parseFloat(result.data[result.data.length - 1]);
  assert.ok(Math.abs(end - 173333.33) < 1, `expected ~173333.33, got ${end}`);
  assert.equal(result.cashFlows.length, 1);
  assert.equal(result.cashFlows[0].amount_cad, -20000);
});

test("whole-portfolio scope ignores internal_transfer flows", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-12-31", account: "A", value: 0 },
    ],
    cashFlows: [
      { date: "2024-06-01", account: "A", amount: -10000, classification: "internal_transfer" },
    ],
  });
  const yahoo = makeYahoo({ "2024-01-01": 100, "2024-06-01": 150, "2024-12-31": 200 });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Internal transfer ignored => same as no-cash-flow case: end = 200000.
  assert.equal(parseFloat(result.data[result.data.length - 1]).toFixed(2), "200000.00");
});

test("per-account scope counts internal_transfer for the chosen account", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-12-31", account: "A", value: 0 },
    ],
    cashFlows: [
      { date: "2024-06-01", account: "A", amount: -10000, classification: "internal_transfer" },
    ],
  });
  const yahoo = makeYahoo({ "2024-01-01": 100, "2024-06-01": 150, "2024-12-31": 200 });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "A", db, yahooFinance: yahoo,
  });

  // Units: 1000 - 10000/150 = 933.33... -> end = 933.33*200 = 186666.67
  const end = parseFloat(result.data[result.data.length - 1]);
  assert.ok(Math.abs(end - 186666.67) < 1, `expected ~186666.67, got ${end}`);
});

test("cash flow on the first snapshot date is not double-counted", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-12-31", account: "A", value: 0 },
    ],
    cashFlows: [
      // Same date as first snapshot — already reflected in the 100k startValue.
      { date: "2024-01-01", account: "A", amount: -10000, classification: "external_out" },
    ],
  });
  const yahoo = makeYahoo({ "2024-01-01": 100, "2024-12-31": 200 });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Seed units = 100000 / 100 = 1000 (the 10k withdrawal is already baked into startValue).
  // End value = 1000 * 200 = 200000. NOT 1000 - 100 = 900 units -> 180000.
  assert.equal(parseFloat(result.data[result.data.length - 1]).toFixed(2), "200000.00");
});

test("income (dividends) is excluded from whole-portfolio simulation", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-12-31", account: "A", value: 0 },
    ],
    cashFlows: [
      { date: "2024-06-01", account: "A", amount: 5000, classification: "income" },
    ],
  });
  const yahoo = makeYahoo({ "2024-01-01": 100, "2024-06-01": 150, "2024-12-31": 200 });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Income ignored => same as no-cash-flow case: end = 200000.
  assert.equal(parseFloat(result.data[result.data.length - 1]).toFixed(2), "200000.00");
});

test("cash flow on a non-trading day uses the next available trading close", async () => {
  const db = setupDb({
    holdings: [
      { date: "2024-01-01", account: "A", value: 100000 },
      { date: "2024-01-10", account: "A", value: 0 },
    ],
    cashFlows: [
      { date: "2024-01-06", account: "A", amount: -10000, classification: "external_out" }, // Saturday
    ],
  });
  const yahoo = makeYahoo({
    "2024-01-01": 100,
    "2024-01-05": 100, // Fri
    "2024-01-08": 100, // Mon — next trading day after Sat 1/6
    "2024-01-10": 110,
  });

  const result = await simulateIndexPortfolio({
    symbol: "^GSPC", scope: "all", db, yahooFinance: yahoo,
  });

  // Units: 100000/100 - 10000/100 = 900. End: 900 * 110 = 99000.
  const end = parseFloat(result.data[result.data.length - 1]);
  assert.ok(Math.abs(end - 99000) < 1);
});
