// routes/upload.js
// POST /upload — accepts one or more CSV files, auto-routes by header type,
// archives each file regardless of parse outcome, returns per-file results.

const express = require("express");
const multer = require("multer");
const fs = require("node:fs");
const csv = require("csv-parser");

const { db } = require("../db");
const { detectCsvType } = require("../lib/csv-detect");
const { archiveUpload } = require("../lib/archive");
const { ingestHoldings } = require("../lib/holdings-ingest");
const { ingestActivity } = require("../lib/activity-ingest");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

const recordUpload = db.prepare(`
  INSERT INTO uploaded_files
    (upload_timestamp, original_filename, archive_path, csv_type, row_count_inserted, row_count_skipped)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function readCsvRows(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function processOneFile(file, yahooFinance) {
  const uploadTimestamp = new Date().toISOString();
  // Always archive first so a parse failure does not lose the source file.
  const archivePath = await archiveUpload({
    srcPath: file.path,
    originalFilename: file.originalname,
    uploadTimestamp,
  });

  // Read rows from the *archived* copy so we never touch the (now-moved) tmp path.
  const rows = await readCsvRows(archivePath);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const type = detectCsvType(headers);

  let result;
  if (type === "holdings") {
    result = ingestHoldings({ rows, uploadTimestamp, db });
  } else if (type === "activity") {
    result = await ingestActivity({ rows, uploadTimestamp, db, yahooFinance });
  } else {
    result = { inserted: 0, skipped: rows.length };
  }

  recordUpload.run(
    uploadTimestamp, file.originalname, archivePath, type,
    result.inserted, result.skipped,
  );

  return {
    filename: file.originalname,
    csv_type: type,
    inserted: result.inserted,
    skipped: result.skipped,
    upload_timestamp: uploadTimestamp,
  };
}

function buildRouter({ yahooFinance }) {
  // Accept either single-file (legacy field name) or multi-file uploads.
  router.post("/upload", upload.any(), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No file uploaded." });
    }
    const results = [];
    for (const file of req.files) {
      try {
        results.push(await processOneFile(file, yahooFinance));
      } catch (err) {
        console.error(`Failed to process ${file.originalname}:`, err);
        results.push({ filename: file.originalname, error: err.message });
      }
    }
    res.json({ message: "Upload complete.", results });
  });
  return router;
}

module.exports = { buildRouter };
