// routes/uploads.js
const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/uploads", (req, res) => {
  try {
    // Prefer uploaded_files (rich metadata); fall back to deriving from holdings rows
    // for any legacy uploads that pre-date the uploaded_files table.
    const uploads = db.prepare(`
      SELECT uf.upload_timestamp,
             uf.original_filename,
             uf.csv_type,
             uf.row_count_inserted AS row_count,
             uf.row_count_skipped,
             COALESCE(
               (SELECT MIN(as_of_date) FROM holdings h WHERE h.upload_timestamp = uf.upload_timestamp),
               (SELECT MIN(date) FROM cash_flows c WHERE c.source_upload_timestamp = uf.upload_timestamp)
             ) AS as_of_date
      FROM uploaded_files uf
      UNION ALL
      SELECT h.upload_timestamp,
             NULL AS original_filename,
             'holdings' AS csv_type,
             COUNT(*) AS row_count,
             0 AS row_count_skipped,
             MIN(h.as_of_date) AS as_of_date
      FROM holdings h
      WHERE h.upload_timestamp NOT IN (SELECT upload_timestamp FROM uploaded_files)
      GROUP BY h.upload_timestamp
      ORDER BY upload_timestamp DESC
      LIMIT 50
    `).all();
    res.json(uploads);
  } catch (error) {
    console.error("Error fetching uploads:", error);
    res.status(500).json({ message: "Error fetching uploads." });
  }
});

router.delete("/uploads/:uploadTimestamp", (req, res) => {
  const { uploadTimestamp } = req.params;
  try {
    const deleteAll = db.transaction(() => {
      const h = db.prepare("DELETE FROM holdings WHERE upload_timestamp = ?").run(uploadTimestamp);
      const c = db.prepare("DELETE FROM cash_flows WHERE source_upload_timestamp = ?").run(uploadTimestamp);
      const u = db.prepare("DELETE FROM uploaded_files WHERE upload_timestamp = ?").run(uploadTimestamp);
      return h.changes + c.changes + u.changes;
    });
    const total = deleteAll();
    res.json({ message: `Deleted ${total} rows for upload ${uploadTimestamp}` });
  } catch (error) {
    console.error("Error deleting upload:", error);
    res.status(500).json({ message: "Error deleting upload." });
  }
});

router.get("/api/unrecognized-activity", (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT date, account_name, amount_cad, activity, description
      FROM cash_flows
      WHERE classification = 'other'
      ORDER BY date DESC
      LIMIT 200
    `).all();
    res.json({ count: rows.length, rows });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
