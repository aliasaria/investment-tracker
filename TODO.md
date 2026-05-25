# TODO

Future ideas and known gaps. Append new items as bullets with enough context to pick up cold.

---

## Time-horizon selector (1M / 3M / 6M / YTD / 1Y / All / custom)

Today the chart shows everything from the earliest holdings snapshot. A range picker would let you ask "how have I done vs the S&P over the last 3 months?"

**Why this isn't just frontend clipping.** The simulator anchors at the very first holdings snapshot:
`units = portfolio_value_at_first_snapshot / index_close_at_first_snapshot`, then walks forward. Just clipping the rendered line to "last 3 months" leaves the index line carrying years of compounded growth — the two series won't start together inside the window, and "who outperformed" loses meaning. The simulator has to be **re-seeded at the start of the chosen window** for the comparison to stay apples-to-apples.

**Design sketch:**

- `lib/simulator.js`: add optional `startDate` / `endDate` params. Anchor logic:
  1. Find the latest holdings snapshot at or before `startDate` → that's the seed date.
  2. `units = portfolio_value_at_seedDate / index_close_at_seedDate`.
  3. Walk cash flows where `seedDate < date <= endDate`.
  4. Emit only for snapshot dates in `[startDate, endDate]`.
- `routes/benchmarks.js`: extend `/api/benchmark/:symbol/simulated` with `?from=YYYY-MM-DD&to=YYYY-MM-DD` query params (both optional, default to full range).
- Optionally extend `/data` with the same `from`/`to` so the portfolio line is clipped server-side; otherwise the frontend can clip the existing payload.
- `index.html`: small button group `All · 1Y · YTD · 6M · 3M · 1M · custom`. Track `currentWindow = {from, to}`. Pass into both the benchmark fetch and any client-side `/data` filter. Compose with the existing `scope=<account>` drilldown — they're orthogonal.

**Subtleties to handle (already thought through):**

- Window starts before the earliest snapshot → anchor at earliest snapshot and show a banner ("Data starts on YYYY-MM-DD; showing from there").
- Window starts between snapshots → seed off the prior snapshot's value (matches current "find previous" behavior for missing per-account values).
- Per-account drill + windowed view → seed query needs `AND account_name = ?`.
- Date math for YTD/1Y → compute on the server, not the client, to avoid clock-skew confusion.
- Existing things that stay untouched: drilldown, freshness strip, ingest pipeline, annotation markers (Chart.js auto-clips to x-axis range).

Estimated size: ~30 backend lines + ~50 frontend lines + a handful of tests in `test/simulator.test.js` (anchor at chosen window, anchor falls between snapshots, window narrower than data).
