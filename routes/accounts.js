// routes/accounts.js
const express = require("express");
const { db } = require("../db");
const { mergeAccounts, unmergeAccount } = require("../lib/account-merges");

const router = express.Router();
router.use(express.json());

// Every raw account number we know about, with its merge status and coverage.
router.get("/api/accounts", (req, res) => {
  try {
    const rows = db.prepare(`
      WITH ids AS (
        SELECT account_number FROM holdings
        UNION SELECT account_number FROM cash_flows
        UNION SELECT account_number FROM account_aliases
      ),
      h AS (
        SELECT account_number, MIN(as_of_date) AS first_date, MAX(as_of_date) AS last_date
        FROM holdings GROUP BY account_number
      ),
      latest AS (
        SELECT h2.account_number, SUM(h2.total_value) AS latest_value
        FROM holdings h2 JOIN h ON h.account_number = h2.account_number AND h.last_date = h2.as_of_date
        GROUP BY h2.account_number
      ),
      cf AS (
        SELECT account_number, MIN(date) AS first_date, MAX(date) AS last_date
        FROM cash_flows GROUP BY account_number
      )
      SELECT ids.account_number,
             a.nickname,
             m.merged_into,
             ma.nickname AS merged_into_nickname,
             h.first_date AS holdings_first_date,
             h.last_date AS holdings_last_date,
             latest.latest_value,
             cf.first_date AS activity_first_date,
             cf.last_date AS activity_last_date
      FROM ids
      LEFT JOIN account_aliases a ON a.account_number = ids.account_number
      LEFT JOIN account_merges m ON m.account_number = ids.account_number
      LEFT JOIN account_aliases ma ON ma.account_number = m.merged_into
      LEFT JOIN h ON h.account_number = ids.account_number
      LEFT JOIN latest ON latest.account_number = ids.account_number
      LEFT JOIN cf ON cf.account_number = ids.account_number
      ORDER BY COALESCE(a.nickname, ids.account_number)
    `).all();
    res.json(rows);
  } catch (err) {
    console.error("Accounts retrieval error:", err);
    res.status(500).json({ message: err.message });
  }
});

router.post("/api/account-merges", (req, res) => {
  const { from, into } = req.body || {};
  try {
    res.json(mergeAccounts(db, from, into));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/api/account-merges/:accountNumber", (req, res) => {
  const removed = unmergeAccount(db, req.params.accountNumber);
  if (!removed) return res.status(404).json({ message: "Account is not merged." });
  res.json({ message: "Unmerged." });
});

module.exports = router;
