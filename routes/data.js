// routes/data.js
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/data", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT h.as_of_date,
             h.account_number,
             COALESCE(a.nickname, h.account_number) AS account_label,
             SUM(h.total_value) AS value
      FROM holdings h
      LEFT JOIN account_aliases a ON a.account_number = h.account_number
      GROUP BY h.as_of_date, h.account_number, a.nickname
      ORDER BY h.as_of_date ASC
    `).all();

    if (rows.length === 0) return res.json({ labels: [], datasets: [] });

    const labels = [...new Set(rows.map((r) => r.as_of_date))].sort();
    const accounts = [...new Set(rows.map((r) => r.account_number))];

    // Each per-account series carries forward its last known value on dates
    // where that account has no snapshot. The total must do the same: summing
    // only same-date rows would understate the portfolio whenever a single
    // account is uploaded for a new date.
    const datasets = accounts.map((accountNumber, index) => {
      const label = rows.find((r) => r.account_number === accountNumber)?.account_label || accountNumber;
      const data = labels.map((dateLabel) => {
        const record = rows.find((r) => r.as_of_date === dateLabel && r.account_number === accountNumber);
        let value = 0;
        if (record) {
          value = record.value;
        } else {
          const previousRecords = rows
            .filter((r) => r.account_number === accountNumber && r.as_of_date < dateLabel)
            .sort((a, b) => new Date(b.as_of_date) - new Date(a.as_of_date));
          if (previousRecords.length > 0) value = previousRecords[0].value;
        }
        return Number(value);
      });

      const colors = ["#4A90E2","#50E3C2","#F5A623","#BD10E0","#9013FE","#4A4A4A","#F8E71C","#D0021B"];
      const color = colors[index % colors.length];

      return {
        label, accountNumber, data: data.map((v) => v.toFixed(2)),
        _rawData: data,
        backgroundColor: `${color}33`, borderColor: color,
        fill: true, tension: 0.1,
      };
    });

    const totalData = labels.map((_, i) =>
      datasets.reduce((sum, ds) => sum + ds._rawData[i], 0).toFixed(2)
    );
    datasets.forEach((ds) => delete ds._rawData);

    datasets.unshift({
      label: "Total",
      data: totalData,
      borderColor: "#111", backgroundColor: "#111", borderWidth: 3,
      fill: false, pointRadius: 2, tension: 0.1, order: 0,
      yAxisID: "y", stack: "__total__",
    });

    res.json({ labels, datasets });
  } catch (error) {
    console.error("Data retrieval error:", error);
    res.status(500).send("Error retrieving data.");
  }
});

// TODO: add a route + UI for editing account_aliases (PUT /api/account-aliases/:account_number).
// Until then, edit aliases manually:
//   sqlite3 investments.db "UPDATE account_aliases SET nickname='New Name' WHERE account_number='12345'"

module.exports = router;
