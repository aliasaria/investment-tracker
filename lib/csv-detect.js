// lib/csv-detect.js
// Sniffs a CSV header row to decide which ingest pipeline handles the file.

const normalize = (h) => String(h).replace(/^﻿/, "").trim();

function detectCsvType(headers) {
  const norm = headers.map(normalize);
  const hasTotalValue = norm.some((h) => h === "Total Value" || h.startsWith("Total Value"));
  const hasActivity = norm.some((h) => h === "Activity");
  if (hasTotalValue) return "holdings";
  if (hasActivity) return "activity";
  return "unknown";
}

module.exports = { detectCsvType };
