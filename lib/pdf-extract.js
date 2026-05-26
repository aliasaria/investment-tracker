// lib/pdf-extract.js
// Thin wrapper around pdf-parse v2 so the rest of the parser layer is unit-testable
// on plain strings without needing real PDFs.
//
// pdf-parse v2 inserts per-page footer markers ("-- N of M --") into the joined text;
// we strip them here because downstream parsers want clean source-PDF text only.

const { PDFParse } = require("pdf-parse");

const PAGE_FOOTER_RE = /-- \d+ of \d+ --\n?/g;

async function extractPdfText(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("extractPdfText: expected a Buffer");
  }
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = (result.text || "").replace(PAGE_FOOTER_RE, "");
    return { text, pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}

module.exports = { extractPdfText };
