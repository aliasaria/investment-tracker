// lib/fx.js
// USD->CAD conversion utilities. Prefers the rate embedded in broker descriptions,
// falls back to a daily Yahoo Finance quote for USDCAD=X.

const cache = new Map(); // 'YYYY-MM-DD' -> rate

function parseFxRateFromDescription(description) {
  if (!description) return null;
  const m = String(description).match(/@(\d+\.\d+)/);
  return m ? parseFloat(m[1]) : null;
}

async function getUsdCadRateForDate(dateStr, { yahooFinance }) {
  if (cache.has(dateStr)) return cache.get(dateStr);

  const target = new Date(`${dateStr}T12:00:00Z`);
  const start = new Date(target.getTime() - 7 * 86400000);
  const end = new Date(target.getTime() + 2 * 86400000);

  const result = await yahooFinance.chart("USDCAD=X", {
    period1: start,
    period2: end,
    interval: "1d",
  });

  const quotes = (result?.quotes || []).filter((q) => q.close != null);
  if (quotes.length === 0) {
    throw new Error(`No USDCAD=X quote available near ${dateStr}`);
  }

  // Find the latest quote with date <= target.
  let pick = quotes[0];
  for (const q of quotes) {
    const qStr = q.date.toISOString().slice(0, 10);
    if (qStr <= dateStr) pick = q;
  }

  cache.set(dateStr, pick.close);
  return pick.close;
}

function _resetCache() {
  cache.clear();
}

module.exports = { parseFxRateFromDescription, getUsdCadRateForDate, _resetCache };
