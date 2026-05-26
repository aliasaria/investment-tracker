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

## Usage

The tool is fed by two CSVs you export from RBC Dominion Securities — there is no manual data entry and no integration. You need both, and you need to do it more than once for the trend view to mean anything.

### 1. Export the two files from RBC DS

Log in to the RBC Dominion Securities site and grab two exports:

- **Holdings CSV** — go to **Account Holdings** (the page that lists positions per account). Use the export / download button on that page. This is a snapshot of *what you own* and what it's worth, on the day you export it.
- **Activity CSV** — go to **Activity** (the page that lists deposits, withdrawals, trades, dividends, transfers). Use the export / download button on that page. Choose as wide a date range as the site offers; the ingester is idempotent so overlapping ranges are fine to re-upload later.

The export buttons live in slightly different spots depending on which version of the DS site you're on, but each page has one — they're the only sources of truth this tool reads from.

### 2. Upload both into the app

Drop both files into the upload area (or upload them one at a time). The file type is auto-detected, so you don't need to label them. Re-uploading the same file is harmless.

### Why both files are needed

The two files answer different questions, and the app needs both to do its main job:

- **Holdings** tells you *what your portfolio is worth right now*. Without it, the app has no portfolio value to plot.
- **Activity** tells you *every dollar that entered or left the portfolio*, plus dividends, trades, and internal transfers. Without it, the parallel-portfolio index comparison can't be honest: it wouldn't know when you deposited or withdrew, so a chart against the S&P 500 would silently treat your contributions as portfolio gains (or your withdrawals as losses).

Together they let the app draw your real portfolio value over time *and* a same-scale "what if I'd put each of those cash flows into the index instead" line — dollar for dollar on the same chart.

### Re-upload over time to see the trend

A single upload is mostly diagnostic — you'll see your current portfolio value and a list of your cash flows, but there's no trend yet. The tool gets useful when you re-export and re-upload **on a recurring basis** (e.g. once a week or once a month). Each new holdings snapshot becomes another point on the portfolio value chart, and each new activity export fills in any cash flows since the last one. After a few cycles you'll have a real time series of your portfolio against the indexes, with deposits and withdrawals correctly accounted for.

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

