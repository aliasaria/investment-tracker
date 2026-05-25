// routes/benchmarks.js
const express = require("express");
const { db } = require("../db");
const { simulateIndexPortfolio } = require("../lib/simulator");

const BENCHMARKS = {
  "^GSPC": { label: "S&P 500", color: "#E74C3C" },
  "^IXIC": { label: "NASDAQ", color: "#2ECC71" },
  "^GSPTSE": { label: "S&P/TSX", color: "#9B59B6" },
  "^DJI": { label: "Dow Jones", color: "#E67E22" },
};

function buildRouter({ yahooFinance }) {
  const router = express.Router();

  router.get("/api/benchmarks", (req, res) => {
    res.json(Object.entries(BENCHMARKS).map(([symbol, info]) => ({ symbol, ...info })));
  });

  router.get("/api/benchmark/:symbol", async (req, res) => {
    const { symbol } = req.params;
    if (!BENCHMARKS[symbol]) return res.status(400).json({ message: "Unknown benchmark symbol." });

    try {
      const range = db.prepare(
        "SELECT MIN(as_of_date) as minDate, MAX(as_of_date) as maxDate FROM holdings",
      ).get();
      if (!range || !range.minDate) return res.json({ labels: [], data: [] });

      const firstTotal = db.prepare(
        "SELECT SUM(total_value) as total FROM holdings WHERE as_of_date = ?",
      ).get(range.minDate);
      const portfolioStartValue = firstTotal ? firstTotal.total : 0;

      const startDate = new Date(range.minDate);
      startDate.setDate(startDate.getDate() - 5);
      const endDate = new Date(range.maxDate);
      endDate.setDate(endDate.getDate() + 1);

      const result = await yahooFinance.chart(symbol, {
        period1: startDate, period2: endDate, interval: "1d",
      });
      if (!result?.quotes?.length) return res.json({ labels: [], data: [] });

      const quotes = result.quotes.filter((q) => q.close != null);
      let baseQuote = null;
      for (const q of quotes) {
        const qDate = q.date.toISOString().slice(0, 10);
        if (qDate <= range.minDate) baseQuote = q;
      }
      if (!baseQuote) baseQuote = quotes[0];
      const basePrice = baseQuote.close;

      const labels = [];
      const data = [];
      for (const q of quotes) {
        const d = q.date.toISOString().slice(0, 10);
        if (d >= range.minDate && d <= range.maxDate) {
          labels.push(d);
          data.push(((q.close / basePrice) * portfolioStartValue).toFixed(2));
        }
      }

      res.json({ symbol, label: BENCHMARKS[symbol].label, color: BENCHMARKS[symbol].color, labels, data });
    } catch (error) {
      console.error(`Error fetching benchmark ${symbol}:`, error.message);
      res.status(500).json({ message: `Error fetching ${symbol} data.` });
    }
  });

  router.get("/api/benchmark/:symbol/simulated", async (req, res) => {
    const { symbol } = req.params;
    const scope = req.query.scope || "all";
    if (!BENCHMARKS[symbol]) return res.status(400).json({ message: "Unknown benchmark symbol." });

    try {
      const sim = await simulateIndexPortfolio({ symbol, scope, db, yahooFinance });
      res.json({
        symbol,
        label: BENCHMARKS[symbol].label,
        color: BENCHMARKS[symbol].color,
        scope,
        ...sim,
      });
    } catch (err) {
      console.error(`Simulated benchmark ${symbol} (scope=${scope}) failed:`, err);
      res.status(500).json({ message: `Error simulating ${symbol}: ${err.message}` });
    }
  });

  return router;
}

module.exports = { buildRouter, BENCHMARKS };
