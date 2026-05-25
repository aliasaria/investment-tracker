// routes/freshness.js
const express = require("express");
const { db } = require("../db");
const { computeFreshness } = require("../lib/freshness");

const router = express.Router();

router.get("/api/freshness", (req, res) => {
  try {
    res.json(computeFreshness(db));
  } catch (err) {
    console.error("Freshness check failed:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
