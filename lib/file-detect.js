// lib/file-detect.js
// Decides which ingest pipeline handles an uploaded file.
// PDFs identified by the "%PDF-" magic bytes; CSVs delegate to the existing
// header-based csv-detect.
const { detectCsvType } = require("./csv-detect");

function isPdf(buffer) {
  if (!buffer || buffer.length < 5) return false;
  return buffer.slice(0, 5).toString("utf8") === "%PDF-";
}

function readFirstLine(buffer) {
  const idx = buffer.indexOf(0x0a); // \n
  const slice = idx === -1 ? buffer : buffer.slice(0, idx);
  return slice.toString("utf8").replace(/\r$/, "");
}

function detectFileType(buffer, filename) {
  if (isPdf(buffer)) return "pdf";
  const firstLine = readFirstLine(buffer);
  const headers = firstLine.split(",").map((h) => h.replace(/^"|"$/g, ""));
  return detectCsvType(headers);
}

module.exports = { detectFileType };
