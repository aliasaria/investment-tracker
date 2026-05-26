// lib/pdf-statement-parse.js
// Parses one sub-statement's text (single currency) into a structured object.
// Activity-row parsing lives in this same module; Task 14 will add parseActivity.

const MONTHS = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const ACCOUNT_RE = /Your Account Number:\s*([\d\-]+)/;
const STATEMENT_DATE_RE = /([A-Z]{3})\.\s*(\d{1,2})\s*\n\s*(\d{4})/;
const FX_RE = /1USD\s*=\s*([\d.]+)\s*CAD/;

const ASSET_CLASS_HEADERS = new Set([
  "FIXED INCOME", "COMMON SHARES", "PREFERRED SHARES",
  "FOREIGN SECURITIES", "MUTUAL FUNDS", "OTHER",
]);

// Footnote glyphs that may trail the market-value column.
const FOOTNOTE_RE = /\s*[¹²³⁴ⁿ°¤*#+]\s*$/u;

// A row is identified by its terminal "$NN,NNN.NN" token (optionally followed by a footnote).
const MV_RE = /\$([\d,]+\.\d{2})$/;

function parseDate(text) {
  const m = text.match(STATEMENT_DATE_RE);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return `${m[3]}-${month}-${m[2].padStart(2, "0")}`;
}

// Returns true if token looks like a stock symbol (uppercase letters/digits/dots, length >= 1).
function isSymbol(tok) {
  return /^[A-Z][A-Z0-9.]*$/.test(tok);
}

// Returns true if token looks like a numeric value (allows commas and minus sign).
function isNumeric(tok) {
  return /^-?[\d,]+(\.\d+)?$/.test(tok);
}

function parseHoldingRow(line, { hasSymbol = true } = {}) {
  // Strip trailing footnote glyph (single char like ¹, optionally with whitespace).
  let stripped = line.replace(FOOTNOTE_RE, "").trim();
  if (!stripped) return null;

  const tokens = stripped.split(/\s+/);
  if (tokens.length < 5) return null;

  const lastTok = tokens[tokens.length - 1];
  const mvMatch = lastTok.match(MV_RE);
  if (!mvMatch) return null;
  const totalValue = parseFloat(mvMatch[1].replace(/,/g, ""));

  // Right-anchored layout: ... [SYMBOL?] QUANTITY PRICE BOOK_COST $MARKET_VALUE
  // tokens[-1] = $MV
  // tokens[-2] = book cost (numeric)
  // tokens[-3] = price (numeric)
  // tokens[-4] = quantity (numeric)
  // tokens[-5] = symbol IF hasSymbol && uppercase-token; otherwise part of name
  const idx = tokens.length;
  const bookCostTok = tokens[idx - 2];
  const priceTok    = tokens[idx - 3];
  const quantityTok = tokens[idx - 4];
  if (!isNumeric(bookCostTok) || !isNumeric(priceTok) || !isNumeric(quantityTok)) {
    return null;
  }
  let symbol = null;
  let nameEndIdx = idx - 4;
  if (hasSymbol && idx >= 6) {
    const symbolCandidate = tokens[idx - 5];
    if (isSymbol(symbolCandidate) && !isNumeric(symbolCandidate)) {
      symbol = symbolCandidate;
      nameEndIdx = idx - 5;
    }
  }
  const name = tokens.slice(0, nameEndIdx).join(" ");
  if (!name) return null;
  return { symbol, name, totalValue };
}

function parseHoldings(text) {
  const lines = text.split("\n");
  const holdings = [];
  let currentProductType = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "ACCOUNT ACTIVITY") break;
    if (line.startsWith("Total Value of")) continue;
    if (ASSET_CLASS_HEADERS.has(line)) { currentProductType = line; continue; }
    if (!currentProductType) continue;
    if (/UNPRICED/.test(line)) continue;  // skip placeholder rows

    // Bonds (FIXED INCOME) have no symbol column; everything else does.
    const hasSymbol = currentProductType !== "FIXED INCOME";
    const row = parseHoldingRow(line, { hasSymbol });
    if (!row) continue;  // continuation lines don't match the $MV terminal pattern
    holdings.push({ ...row, productType: currentProductType });
  }
  return holdings;
}

function parseStatement({ currency, text }) {
  const accountMatch = text.match(ACCOUNT_RE);
  if (!accountMatch) throw new Error("parseStatement: account number not found");
  const accountNumber = accountMatch[1];

  const asOfDate = parseDate(text);
  if (!asOfDate) throw new Error("parseStatement: statement date not found");

  const fxMatch = text.match(FX_RE);
  const fxRate = fxMatch ? parseFloat(fxMatch[1]) : null;

  const holdings = parseHoldings(text);
  const activity = []; // Task 14 will populate this

  return { accountNumber, asOfDate, currency, fxRate, holdings, activity };
}

module.exports = { parseStatement, parseHoldings, parseHoldingRow };
