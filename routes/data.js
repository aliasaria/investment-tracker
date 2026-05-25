// routes/data.js
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/data", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT as_of_date, account_name, SUM(total_value) as value
      FROM holdings
      GROUP BY as_of_date, account_name
      ORDER BY as_of_date ASC
    `).all();

    if (rows.length === 0) return res.json({ labels: [], datasets: [] });

    const labels = [...new Set(rows.map((r) => r.as_of_date))].sort();
    const accountNames = [...new Set(rows.map((r) => r.account_name))];

    const totalsByDate = {};
    labels.forEach((label) => {
      totalsByDate[label] = rows
        .filter((r) => r.as_of_date === label)
        .reduce((sum, r) => sum + Number(r.value), 0);
    });

    const datasets = accountNames.map((account, index) => {
      const data = labels.map((label) => {
        const record = rows.find((r) => r.as_of_date === label && r.account_name === account);
        let value = 0;
        if (record) {
          value = record.value;
        } else {
          const previousRecords = rows
            .filter((r) => r.account_name === account && r.as_of_date < label)
            .sort((a, b) => new Date(b.as_of_date) - new Date(a.as_of_date));
          if (previousRecords.length > 0) value = previousRecords[0].value;
        }
        return value.toFixed(2);
      });

      const colors = ["#4A90E2","#50E3C2","#F5A623","#BD10E0","#9013FE","#4A4A4A","#F8E71C","#D0021B"];
      const color = colors[index % colors.length];

      return {
        label: account, data,
        backgroundColor: `${color}33`, borderColor: color,
        fill: true, tension: 0.1,
      };
    });

    datasets.unshift({
      label: "Total",
      data: labels.map((label) => totalsByDate[label].toFixed(2)),
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

module.exports = router;
