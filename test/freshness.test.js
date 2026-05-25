// test/freshness.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { computeFreshness } = require("../lib/freshness");

function setupDb({ holdings = [], cashFlows = [] } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE holdings (id INTEGER PRIMARY KEY, as_of_date TEXT, upload_timestamp TEXT, account_name TEXT, total_value REAL);
    CREATE TABLE cash_flows (id INTEGER PRIMARY KEY, date TEXT, classification TEXT);
  `);
  const ih = db.prepare("INSERT INTO holdings (as_of_date, upload_timestamp, account_name, total_value) VALUES (?, '', '', 0)");
  for (const d of holdings) ih.run(d);
  const ic = db.prepare("INSERT INTO cash_flows (date, classification) VALUES (?, 'external_out')");
  for (const d of cashFlows) ic.run(d);
  return db;
}

test("returns empty structure when DB is empty", () => {
  const db = setupDb();
  const f = computeFreshness(db);
  assert.equal(f.holdings.count, 0);
  assert.equal(f.activity.count, 0);
  assert.deepEqual(f.warnings, []);
});

test("warns when holdings are newer than latest activity by more than the threshold", () => {
  const db = setupDb({
    holdings: ["2026-01-01", "2026-05-01"],
    cashFlows: ["2025-12-15"],
  });
  const f = computeFreshness(db);
  const warn = f.warnings.find((w) => w.kind === "holdings_newer_than_activity");
  assert.ok(warn, "expected holdings_newer_than_activity warning");
  assert.match(warn.message, /gap/);
});

test("does not warn when gap is within threshold", () => {
  const db = setupDb({
    holdings: ["2026-05-10"],
    cashFlows: ["2026-05-08"], // 2 days
  });
  const f = computeFreshness(db);
  assert.equal(f.warnings.filter((w) => w.kind === "holdings_newer_than_activity").length, 0);
});

test("notes when activity extends past last holdings snapshot", () => {
  const db = setupDb({
    holdings: ["2026-05-01"],
    cashFlows: ["2026-05-01", "2026-05-10", "2026-05-15"],
  });
  const f = computeFreshness(db);
  assert.equal(f.activity.postHoldingsCount, 2);
  const warn = f.warnings.find((w) => w.kind === "activity_past_holdings");
  assert.ok(warn);
});

test("notes pre-tracking activity", () => {
  const db = setupDb({
    holdings: ["2025-06-01"],
    cashFlows: ["2024-08-01", "2024-08-19", "2025-06-15"],
  });
  const f = computeFreshness(db);
  assert.equal(f.activity.preTrackingCount, 2);
  const warn = f.warnings.find((w) => w.kind === "pre_tracking_activity");
  assert.ok(warn);
});

test("includes monthly activity histogram over the holdings window", () => {
  const db = setupDb({
    holdings: ["2025-06-01", "2025-09-30"],
    cashFlows: ["2025-06-15", "2025-08-01", "2025-08-15"],
  });
  const f = computeFreshness(db);
  // Months covered: 2025-06, 2025-07, 2025-08, 2025-09
  assert.equal(f.activity.monthly.length, 4);
  assert.deepEqual(f.activity.monthly, [
    { month: "2025-06", count: 1 },
    { month: "2025-07", count: 0 },
    { month: "2025-08", count: 2 },
    { month: "2025-09", count: 0 },
  ]);
});

test("monthly is empty when no holdings", () => {
  const db = setupDb({ holdings: [], cashFlows: ["2025-06-15"] });
  const f = computeFreshness(db);
  assert.deepEqual(f.activity.monthly, []);
});

test("fires interior_activity_gap for runs of 2+ consecutive empty months", () => {
  const db = setupDb({
    holdings: ["2025-06-01", "2025-12-31"],
    cashFlows: ["2025-06-15", "2025-12-20"], // June and December populated; July-Nov empty (5-month run)
  });
  const f = computeFreshness(db);
  const gaps = f.warnings.filter((w) => w.kind === "interior_activity_gap");
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].months, ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11"]);
  assert.match(gaps[0].message, /5 months/);
});

test("does not fire interior_activity_gap for a single empty month", () => {
  const db = setupDb({
    holdings: ["2025-06-01", "2025-08-31"],
    cashFlows: ["2025-06-15", "2025-08-15"], // July empty (only 1 month)
  });
  const f = computeFreshness(db);
  assert.equal(f.warnings.filter((w) => w.kind === "interior_activity_gap").length, 0);
});

test("emits one warning per disjoint zero-run", () => {
  const db = setupDb({
    holdings: ["2025-01-01", "2025-12-31"],
    cashFlows: [
      "2025-01-15",
      // 2025-02, 2025-03 empty (gap 1, 2 months)
      "2025-04-15",
      "2025-05-15",
      // 2025-06, 2025-07, 2025-08 empty (gap 2, 3 months)
      "2025-09-15",
      "2025-12-15",
      // 2025-10, 2025-11 empty (gap 3, 2 months)
    ],
  });
  const f = computeFreshness(db);
  const gaps = f.warnings.filter((w) => w.kind === "interior_activity_gap");
  assert.equal(gaps.length, 3);
  assert.deepEqual(gaps[0].months, ["2025-02", "2025-03"]);
  assert.deepEqual(gaps[1].months, ["2025-06", "2025-07", "2025-08"]);
  assert.deepEqual(gaps[2].months, ["2025-10", "2025-11"]);
});

test("trailing zero-run does NOT fire interior_activity_gap (covered by holdings_newer_than_activity)", () => {
  const db = setupDb({
    holdings: ["2025-01-01", "2025-12-31"],
    cashFlows: [
      "2025-01-15",
      "2025-02-15",
      // 2025-03 onwards: empty, but at the END of the window — not "interior"
    ],
  });
  const f = computeFreshness(db);
  const interior = f.warnings.filter((w) => w.kind === "interior_activity_gap");
  assert.equal(interior.length, 0, "no interior_activity_gap should fire for trailing zeros");
  // The day-level check should still fire since 2025-02-15 is well before 2025-12-31.
  const dayLevel = f.warnings.filter((w) => w.kind === "holdings_newer_than_activity");
  assert.equal(dayLevel.length, 1, "day-level warning should fire");
});
