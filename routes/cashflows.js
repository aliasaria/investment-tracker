// routes/cashflows.js
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/api/cash-flows", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT cf.date,
             cf.account_number,
             COALESCE(a.nickname, cf.account_number) AS account_label,
             cf.amount_cad,
             cf.activity,
             cf.description,
             cf.classification
      FROM cash_flows cf
      LEFT JOIN account_aliases a ON a.account_number = cf.account_number
      WHERE cf.amount_cad IS NOT NULL
      ORDER BY cf.date ASC
    `).all();
    res.json(rows);
  } catch (error) {
    console.error("Cash-flows retrieval error:", error);
    res.status(500).send("Error retrieving cash flows.");
  }
});

module.exports = router;
