// lib/simulator.js
// Simulates a "parallel index portfolio" that experiences the same external cash
// flows as the real portfolio, so its value at any date is directly comparable
// in dollars. See spec §5.

async function simulateIndexPortfolio({ symbol, scope, db, yahooFinance }) {
  // 1. Determine the date range from holdings.
  const range = db.prepare(`
    SELECT MIN(as_of_date) AS minDate, MAX(as_of_date) AS maxDate FROM holdings
  `).get();
  if (!range || !range.minDate) {
    return { labels: [], data: [], cashFlows: [], startDate: null, endDate: null };
  }

  // 2. Fetch daily index closes over the range plus a small buffer.
  const startDate = new Date(`${range.minDate}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 7);
  const endDate = new Date(`${range.maxDate}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 2);

  const fetched = await yahooFinance.chart(symbol, {
    period1: startDate, period2: endDate, interval: "1d",
  });
  const quotes = (fetched?.quotes || [])
    .filter((q) => q.close != null)
    .map((q) => ({ date: q.date.toISOString().slice(0, 10), close: q.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (quotes.length === 0) {
    return { labels: [], data: [], cashFlows: [], startDate: range.minDate, endDate: range.maxDate };
  }

  // Helper: index close on a given date, falling back to the *next* trading day
  // (matches the "weekend cash flow uses next trading close" rule from the spec).
  const closeOnOrAfter = (dateStr) => {
    for (const q of quotes) if (q.date >= dateStr) return q;
    return quotes[quotes.length - 1];
  };
  // Helper: index close on a given date, falling back to the most recent *prior*
  // close (used for holdings snapshot dates so we always have a value).
  const closeOnOrBefore = (dateStr) => {
    let pick = null;
    for (const q of quotes) {
      if (q.date <= dateStr) pick = q;
      else break;
    }
    return pick || quotes[0];
  };

  // 3. Snapshot dates — determined first so snapshotDates[0] can serve as the
  //    exclusive lower bound for cash flows (flows on day 0 are already baked
  //    into startValue and must not be double-counted).
  const snapshotDates = db.prepare(`
    SELECT DISTINCT as_of_date FROM holdings
    ${scope === "all" ? "" : "WHERE account_number = ?"}
    ORDER BY as_of_date ASC
  `).all(...(scope === "all" ? [] : [scope])).map((r) => r.as_of_date);

  // 4. Build the cash-flow stream for the scope (strictly after snapshotDates[0]).
  let cashFlowRows;
  if (scope === "all") {
    cashFlowRows = db.prepare(`
      SELECT date, account_number, amount_cad, activity, description
      FROM cash_flows
      WHERE classification IN ('external_in', 'external_out')
        AND date > ? AND date <= ?
      ORDER BY date ASC
    `).all(snapshotDates[0], range.maxDate);
  } else {
    cashFlowRows = db.prepare(`
      SELECT date, account_number, amount_cad, activity, description
      FROM cash_flows
      WHERE classification IN ('external_in', 'external_out', 'internal_transfer')
        AND account_number = ?
        AND date > ? AND date <= ?
      ORDER BY date ASC
    `).all(scope, snapshotDates[0], range.maxDate);
  }

  // 5. Starting portfolio value and walk-forward.
  const startValueRow = db.prepare(`
    SELECT SUM(total_value) AS total FROM holdings
    WHERE as_of_date = ? ${scope === "all" ? "" : "AND account_number = ?"}
  `).get(...(scope === "all" ? [snapshotDates[0]] : [snapshotDates[0], scope]));
  const startValue = startValueRow?.total || 0;

  let units = startValue / closeOnOrBefore(snapshotDates[0]).close;
  const data = [];
  let cfIdx = 0;
  for (const snap of snapshotDates) {
    while (cfIdx < cashFlowRows.length && cashFlowRows[cfIdx].date <= snap) {
      const cf = cashFlowRows[cfIdx];
      const px = closeOnOrAfter(cf.date).close;
      units += cf.amount_cad / px;
      cfIdx++;
    }
    const value = units * closeOnOrBefore(snap).close;
    data.push(value.toFixed(2));
  }

  return {
    labels: snapshotDates,
    data,
    cashFlows: cashFlowRows.map((cf) => ({
      date: cf.date,
      account: cf.account_number,
      amount_cad: cf.amount_cad,
      activity: cf.activity,
      description: cf.description,
    })),
    startDate: range.minDate,
    endDate: range.maxDate,
  };
}

module.exports = { simulateIndexPortfolio };
