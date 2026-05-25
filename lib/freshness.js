// lib/freshness.js
// Detects mismatches between holdings and cash_flows date coverage. See spec §8.

const FRESHNESS_GAP_THRESHOLD_DAYS = 7;
const INTERIOR_GAP_THRESHOLD_MONTHS = 2;

function nextMonth(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function listMonths(startMonth, endMonth) {
  const out = [];
  let cur = startMonth;
  while (cur <= endMonth) {
    out.push(cur);
    cur = nextMonth(cur);
  }
  return out;
}

function daysBetween(aStr, bStr) {
  const a = new Date(`${aStr}T00:00:00Z`).getTime();
  const b = new Date(`${bStr}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86400000);
}

function computeFreshness(db) {
  const h = db.prepare(`SELECT MIN(as_of_date) AS firstDate, MAX(as_of_date) AS lastDate, COUNT(DISTINCT as_of_date) AS count FROM holdings`).get();
  const a = db.prepare(`SELECT MIN(date) AS firstDate, MAX(date) AS lastDate, COUNT(*) AS count FROM cash_flows`).get();

  const warnings = [];

  // post-holdings activity
  let postHoldingsCount = 0;
  if (h.lastDate && a.lastDate && a.lastDate > h.lastDate) {
    postHoldingsCount = db.prepare(`SELECT COUNT(*) AS n FROM cash_flows WHERE date > ?`).get(h.lastDate).n;
    warnings.push({
      kind: "activity_past_holdings",
      message: `${postHoldingsCount} activity entries after your last holdings snapshot — upload latest holdings to extend the chart.`,
      postHoldingsCount,
    });
  }

  // pre-tracking activity
  let preTrackingCount = 0;
  if (h.firstDate && a.firstDate && a.firstDate < h.firstDate) {
    preTrackingCount = db.prepare(`SELECT COUNT(*) AS n FROM cash_flows WHERE date < ?`).get(h.firstDate).n;
    warnings.push({
      kind: "pre_tracking_activity",
      message: `${preTrackingCount} pre-tracking activity entries on file (before ${h.firstDate}). Not used in simulation.`,
      preTrackingCount,
    });
  }

  // holdings newer than activity
  if (h.lastDate && a.lastDate && h.lastDate > a.lastDate) {
    const gap = daysBetween(h.lastDate, a.lastDate);
    if (gap > FRESHNESS_GAP_THRESHOLD_DAYS) {
      warnings.push({
        kind: "holdings_newer_than_activity",
        message: `Holdings cover up to ${h.lastDate} but latest activity is ${a.lastDate} — ${gap}-day gap. Index comparison may be inaccurate in this range.`,
        gap,
        holdingsLastDate: h.lastDate,
        activityLastDate: a.lastDate,
      });
    }
  }

  // monthly activity histogram over the holdings window
  let monthly = [];
  if (h.firstDate && h.lastDate) {
    const startMonth = h.firstDate.slice(0, 7);
    const endMonth = h.lastDate.slice(0, 7);
    const months = listMonths(startMonth, endMonth);

    // Query activity counts grouped by month within the holdings window
    const rows = db.prepare(
      `SELECT substr(date, 1, 7) AS month, COUNT(*) AS n FROM cash_flows WHERE date >= ? AND date <= ? GROUP BY month`
    ).all(h.firstDate, h.lastDate);
    const countByMonth = {};
    for (const row of rows) countByMonth[row.month] = row.n;

    monthly = months.map((month) => ({ month, count: countByMonth[month] || 0 }));

    // Detect interior activity gaps: runs of >= INTERIOR_GAP_THRESHOLD_MONTHS consecutive zero-count months
    // Only emit when the run *closes* (transitions back to nonzero) — trailing runs are covered by
    // the holdings_newer_than_activity day-level check above and must not be double-reported here.
    let runMonths = [];
    for (let i = 0; i < monthly.length; i++) {
      const { month, count } = monthly[i];
      if (count === 0) {
        runMonths.push(month);
      } else {
        if (runMonths.length >= INTERIOR_GAP_THRESHOLD_MONTHS) {
          warnings.push({
            kind: "interior_activity_gap",
            message: `No activity entries for ${runMonths.length} months inside your holdings window (${runMonths[0]} to ${runMonths[runMonths.length - 1]}). If you took withdrawals during this period, the index comparison for that range is inaccurate. Upload activity statements for those months.`,
            months: [...runMonths],
          });
        }
        runMonths = [];
      }
    }
    // Trailing run intentionally ignored — covered by holdings_newer_than_activity.
  }

  return {
    holdings: { firstDate: h.firstDate, lastDate: h.lastDate, count: h.count || 0 },
    activity: {
      firstDate: a.firstDate, lastDate: a.lastDate, count: a.count || 0,
      preTrackingCount, postHoldingsCount,
      monthly,
    },
    warnings,
  };
}

module.exports = { computeFreshness, FRESHNESS_GAP_THRESHOLD_DAYS, INTERIOR_GAP_THRESHOLD_MONTHS };
