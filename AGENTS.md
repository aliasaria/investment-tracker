# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, Codex, Aider, etc.) working in this repo. `CLAUDE.md` is a symlink to this file.

## Project

- Local-first web app that tracks a multi-account RBC Dominion Securities portfolio against major indexes.
- Stack: Node + Express, `better-sqlite3`, vanilla HTML/JS frontend, `node --test`. No build step.
- Data lives in `investments.db` (SQLite, repo root). Every raw upload is archived to `uploads/archive/YYYY/MM/`.

## Commands

- `npm install` — install deps.
- `npm start` — serve on http://localhost:3000.
- `npm run dev` — same, with nodemon.
- `npm test` — runs `node --test 'test/**/*.test.js'`.

## Layout

- `server.js` — Express bootstrap; mounts routers.
- `db.js` — SQLite open + schema (idempotent `CREATE TABLE IF NOT EXISTS`).
- `lib/*.js` — pure logic, each unit-tested:
  - `csv-detect.js` — auto-detect Holdings vs Activity CSV.
  - `classify.js` — activity row → cash-flow category.
  - `fx.js` — USD→CAD via description-embedded rate, falling back to Yahoo daily USDCAD.
  - `archive.js` — writes raw uploads under `uploads/archive/YYYY/MM/`.
  - `holdings-ingest.js`, `activity-ingest.js` — DB insert paths.
  - `simulator.js` — parallel-portfolio index simulation.
  - `freshness.js` — staleness / gap diagnostics.
- `routes/` — one Express router per concern (`upload`, `uploads`, `data`, `benchmarks`, `freshness`).
- `test/` — `node --test` suites, one per `lib/` unit + `db-schema.test.js` + `sanity.test.js`.
- `index.html` — single-page frontend.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design references.

## Data model: why two CSVs

The app ingests two distinct CSV exports from RBC Dominion Securities, and the schema mirrors them:

- **Holdings export** (from the Account Holdings page) → `holdings` table. A snapshot per account per `as_of_date`: what was owned, what it was worth in CAD. Re-uploading the same day is idempotent.
- **Activity export** (from the Activity page) → `cash_flows` table. One row per broker activity entry (deposit, withdrawal, dividend, trade, transfer, fee), each tagged with a `classification`.

Both are needed because they answer different questions:

- Holdings alone gives portfolio value but no honest benchmark — without knowing when money entered/left, comparing against the S&P 500 silently attributes contributions to "gains."
- Activity alone gives cash-flow history but no portfolio value to plot or compare.

The user is expected to re-export and re-upload periodically (weekly/monthly). Each holdings upload adds a point to the value time series; each activity upload extends the cash-flow history. Most analysis is only meaningful after several upload cycles.

## Querying the database directly

Agents can — and should — open `investments.db` to answer portfolio questions instead of writing a query layer.

```sh
sqlite3 -readonly investments.db
```

Use `-readonly` unless explicitly asked to modify. Never run schema migrations without confirmation.

### Schema

**`holdings`** — snapshots of positions at a point in time. Re-uploading a same-day file upserts via `holdings_uniq (as_of_date, account_name, symbol, name)`.

| column | meaning |
|---|---|
| `id` | autoincrement |
| `as_of_date` | ISO date of the snapshot (YYYY-MM-DD); derived from upload date |
| `upload_timestamp` | ISO datetime of the upload that produced this row |
| `account_name` | e.g. `RRSP - Joe`, `TFSA - Joe`, `Joint` |
| `symbol` | ticker (nullable for cash) |
| `name` | security name |
| `product_type` | broker's category string |
| `total_value` | **CAD value of the position** (already converted) |

**`cash_flows`** — every Activity row, classified.

| column | meaning |
|---|---|
| `date` | ISO date (YYYY-MM-DD) |
| `account_name` | as above |
| `amount_cad` | **canonical CAD amount** (signed; positive in, negative out) |
| `amount_original` | amount in the original currency |
| `currency_original` | `CAD` or `USD` |
| `fx_rate` | rate used if currency was USD (nullable) |
| `activity` | broker's Activity column verbatim (e.g. `Dividends`, `Buy`, `Withdrawals & De-Registrations`) |
| `description` | broker's Description column verbatim |
| `classification` | one of the enum values below |
| `source_upload_timestamp` | FK-ish link to `uploaded_files.upload_timestamp` |

Uniqueness: `(date, account_name, amount_original, description)` — re-uploading overlapping activity is idempotent.

**`uploaded_files`** — audit log of every CSV ingested.

### `classification` enum

| value | meaning | moves simulator? |
|---|---|---|
| `external_in` | Deposit into the portfolio | yes |
| `external_out` | Withdrawal, wire, EFT, fees, taxes | yes |
| `internal_transfer` | Between two tracked accounts | per-account only; whole-portfolio nets to zero |
| `income` | Dividends, interest, distributions, bond maturity, return of capital | no (already in holdings) |
| `trade` | Intra-account Buy/Sell | no (no net cash effect) |
| `fx` | Intra-account CAD↔USD conversion legs | no (legs net to zero) |
| `other` | Unrecognized; surfaced in UI for refinement | no |

### Cookbook queries

Latest portfolio value per account:

```sql
WITH latest AS (
  SELECT account_name, MAX(as_of_date) AS d FROM holdings GROUP BY account_name
)
SELECT h.account_name, h.as_of_date, ROUND(SUM(h.total_value), 2) AS value_cad
FROM holdings h JOIN latest l ON l.account_name = h.account_name AND l.d = h.as_of_date
GROUP BY h.account_name ORDER BY value_cad DESC;
```

Total external deposits / withdrawals by year:

```sql
SELECT substr(date,1,4) AS year,
       ROUND(SUM(CASE WHEN classification='external_in'  THEN amount_cad ELSE 0 END),2) AS deposits,
       ROUND(SUM(CASE WHEN classification='external_out' THEN amount_cad ELSE 0 END),2) AS withdrawals
FROM cash_flows GROUP BY year ORDER BY year;
```

Dividend / interest income by year and account:

```sql
SELECT substr(date,1,4) AS year, account_name, ROUND(SUM(amount_cad),2) AS income_cad
FROM cash_flows WHERE classification='income'
GROUP BY year, account_name ORDER BY year, income_cad DESC;
```

Fees paid (best-effort: `external_out` rows whose `activity` is Fees/Taxes):

```sql
SELECT substr(date,1,4) AS year, activity, ROUND(SUM(-amount_cad),2) AS paid_cad
FROM cash_flows WHERE activity IN ('Fees','Taxes')
GROUP BY year, activity ORDER BY year;
```

Top 10 current holdings across the whole portfolio:

```sql
WITH latest AS (
  SELECT account_name, MAX(as_of_date) AS d FROM holdings GROUP BY account_name
)
SELECT h.symbol, h.name, ROUND(SUM(h.total_value),2) AS value_cad
FROM holdings h JOIN latest l ON l.account_name=h.account_name AND l.d=h.as_of_date
WHERE h.symbol IS NOT NULL
GROUP BY h.symbol, h.name ORDER BY value_cad DESC LIMIT 10;
```

Unrecognized activity that needs a classify-rule (also visible in UI):

```sql
SELECT date, account_name, activity, description, amount_cad
FROM cash_flows WHERE classification='other' ORDER BY date DESC LIMIT 50;
```

Net external cash flow over the last 12 months (the number the simulator cares about):

```sql
SELECT ROUND(SUM(amount_cad),2) AS net_external_cad
FROM cash_flows
WHERE classification IN ('external_in','external_out')
  AND date >= date('now','-12 months');
```

Activity coverage check — months with any cash flow per account:

```sql
SELECT account_name, substr(date,1,7) AS month, COUNT(*) AS rows
FROM cash_flows GROUP BY account_name, month ORDER BY account_name, month;
```

### Query gotchas

- Holdings are **snapshots**, not a time series of transactions — always join to the latest `as_of_date` per account unless you specifically want history.
- `amount_cad` is the canonical figure. `amount_original` + `currency_original` is for audit only.
- `internal_transfer` is real at per-account scope but cancels at portfolio scope — exclude it from whole-portfolio cash-flow math.
- `income` and `trade` are already reflected in subsequent `holdings` snapshots; do **not** add them to external cash flow.
- Dates are ISO strings, lexically sortable. Don't `CAST` them.
- `account_name` is freeform broker text — group on it as-is; don't normalize.

## Design decisions

- **Parallel-portfolio simulation vs % return.** The honest comparison answers "what if I'd put every external cash flow into the index on the same day instead?" — that produces a dollar curve directly comparable to the portfolio. Percentage returns lie when deposits/withdrawals are unevenly timed.
- **FX from description, Yahoo fallback.** Broker description lines often embed the rate they used; preferring that preserves cent-level reconciliation with the statement. Yahoo daily USDCAD is the fallback when absent.
- **Archive everything.** Every raw CSV upload is preserved under `uploads/archive/YYYY/MM/`. Re-ingesting is idempotent thanks to the uniqueness indexes — safe to re-run.
- **Unrecognized activity is loud, not silent.** Rows that don't match a classify rule become `classification='other'` and surface in a UI panel. Never drop unknown rows on the floor.
- **Local-first, single SQLite file.** No server, no auth, no migrations system — just `investments.db` next to the code. Schema is `CREATE TABLE IF NOT EXISTS` at boot.

## Conventions

- Pure logic in `lib/`, each module with a paired `test/<name>.test.js`.
- Routes stay thin — parse, call into `lib/`, respond.
- `node --test` only; no Jest/Mocha. Keep it that way.
- New activity prefixes / patterns → extend `lib/classify.js` **and** add a case to `test/classify.test.js`.

## Don't

- **Never store PII in this repo.** No account numbers, names, addresses, SINs, balances, holdings, transaction amounts, or anything traceable to a real person — not in code, comments, tests, fixtures, docs, commit messages, or sample CSVs. If you need test data, fabricate it. `investments.db` and `uploads/archive/` are gitignored for this reason; keep it that way. If you spot PII in a diff, stop and flag it before committing.
- Don't write to `investments.db` from an agent session without explicit go-ahead. Reads are fine.
- Don't hand-reshape broker CSVs to make ingestion work — fix the parser/classifier instead.
- Don't bypass the archive step on the upload path; auditability depends on it.
- Don't add a test framework or build step. The repo's value is that it stays trivially runnable.
