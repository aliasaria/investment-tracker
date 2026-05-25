# Investment Tracker

A small local web app to track a multi-account investment portfolio against market indexes, honestly accounting for deposits and withdrawals.

## Features

- **Works with RBC Dominion Securities** — built around the CSV exports their site produces, no manual reshaping required.
- **Direct upload of broker CSVs** — drop in **Holdings** snapshots (positions and balances per account) and **Activity** statements (deposits, withdrawals, dividends, internal transfers); the file type is auto-detected and ingested.
- **Multi-account tracking** — every account (RRSP, TFSA, non-registered, joint, etc.) is tracked separately and summed to a portfolio total.
- **Honest index comparison via parallel-portfolio simulation** — compares against S&P 500, NASDAQ, S&P/TSX, and Dow Jones by simulating an index portfolio that "buys" and "sells" on every external cash flow you made. The result is a direct dollar-for-dollar line on the same chart, so deposits and withdrawals don't fake out the comparison the way percentage-return charts do.
- **Per-account drilldown** — click "drill in" beside any account to rescope the index comparison to that account alone (internal transfers in/out of that account are then treated as external cash flows).
- **USD ↔ CAD FX handling** — USD trades are converted using the rate embedded in the broker's description line when present, falling back to a daily Yahoo Finance USDCAD quote.
- **Cash flow classification** — every activity row is tagged (external in/out, internal transfer, income, trade, fx, other). Unrecognized rows surface in a dedicated panel so nothing silently vanishes from the simulation.
- **Data freshness diagnostics** — a freshness strip, an activity-coverage histogram, and gap warnings call out stale holdings, missing months, or activity entries that postdate your last holdings snapshot.
- **Local-first storage** — everything lives in a single SQLite file (`investments.db`); every raw upload is archived under `uploads/archive/YYYY/MM/` for auditability.
- **Chart annotations at cash flow dates** — vertical markers on the chart; hover for the amount, direction, and account.
- **Agent-friendly** — because the data is just a local SQLite database, you can point an agentic harness (e.g. Claude Code) at `investments.db` and ask freeform questions about your portfolio — performance per account, fees over time, dividend yield by year, etc. — without writing a query layer yourself.

## Running

```sh
npm install
npm start
```

Opens http://localhost:3000 in your browser.

## Tests

```sh
npm test
```

## Architecture

- `server.js` — express bootstrap, mounts routes.
- `db.js` — SQLite connection + schema.
- `lib/` — pure logic units, each unit-tested:
  - `csv-detect.js`, `classify.js`, `fx.js`, `archive.js`,
  - `holdings-ingest.js`, `activity-ingest.js`,
  - `simulator.js`, `freshness.js`
- `routes/` — express routers, one file per concern.
- `test/` — `node --test` test suites.

## Cash flow classification

Activity rows are classified as one of:

| Classification | Meaning | Used by simulator? |
|---|---|---|
| `external_out` | Money left the portfolio (withdrawal, wire, EFT) | yes |
| `external_in` | Money entered the portfolio | yes |
| `internal_transfer` | Move between two tracked accounts (e.g. spousal RRSP contribution) | per-account scope only; whole-portfolio ignores |
| `income` | Dividends and interest received | no (already reflected in holdings totals) |
| `trade` | Intra-portfolio Buy/Sell — no net cash effect | no |
| `other` | Anything not yet recognized | no; visible in the "Unrecognized activity" UI panel |

To refine: add more rules to `lib/classify.js` and a test in `test/classify.test.js`.

## Design references

- Spec: `docs/superpowers/specs/2026-05-24-portfolio-vs-index-with-cashflows-design.md`
- Plan: `docs/superpowers/plans/2026-05-24-portfolio-vs-index-with-cashflows.md`

