// test/fx.test.js
const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const { parseFxRateFromDescription, getUsdCadRateForDate, _resetCache } = require("../lib/fx");

test("parses '@0.733' from a WHD description", () => {
  assert.equal(
    parseFxRateFromDescription("WHD - 12263.22(u$ To C$ @0.733)"),
    0.733,
  );
});

test("parses '@0.7488' with extra precision", () => {
  assert.equal(
    parseFxRateFromDescription("WHD - 16992.78(u$ To C$ @0.7488)"),
    0.7488,
  );
});

test("returns null when no rate present", () => {
  assert.equal(parseFxRateFromDescription("DIV - Apple Inc Dividend"), null);
  assert.equal(parseFxRateFromDescription(""), null);
  assert.equal(parseFxRateFromDescription(null), null);
});

test("getUsdCadRateForDate fetches from Yahoo and caches", async (t) => {
  _resetCache();
  let calls = 0;
  const fakeYahoo = {
    chart: async (sym, opts) => {
      calls++;
      assert.equal(sym, "USDCAD=X");
      return { quotes: [{ date: new Date("2024-08-19T20:00:00Z"), close: 1.36 }] };
    },
  };

  const rate1 = await getUsdCadRateForDate("2024-08-19", { yahooFinance: fakeYahoo });
  const rate2 = await getUsdCadRateForDate("2024-08-19", { yahooFinance: fakeYahoo });
  assert.equal(rate1, 1.36);
  assert.equal(rate2, 1.36);
  assert.equal(calls, 1, "second call should hit cache");
});

test("getUsdCadRateForDate falls back to nearest prior quote on a non-trading day", async () => {
  _resetCache();
  const fakeYahoo = {
    chart: async () => ({
      quotes: [
        { date: new Date("2024-08-16T20:00:00Z"), close: 1.35 }, // Fri
        // weekend gap
        { date: new Date("2024-08-19T20:00:00Z"), close: 1.36 }, // Mon
      ],
    }),
  };
  // Saturday — should pick Friday's 1.35
  const rate = await getUsdCadRateForDate("2024-08-17", { yahooFinance: fakeYahoo });
  assert.equal(rate, 1.35);
});
