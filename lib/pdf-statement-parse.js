// lib/pdf-statement-parse.js
// Parses one sub-statement's text (single currency) into a structured object.
// Activity-row parsing lives in this same module; Task 14 will add parseActivity.

const { normalizeAccountNumber } = require("./account-id");

const MONTHS = {
  "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
  "MAY": "05",
  "JUN": "06", "JUNE": "06",
  "JUL": "07", "JULY": "07",
  "AUG": "08",
  "SEP": "09", "SEPT": "09",
  "OCT": "10", "NOV": "11", "DEC": "12",
};

const ACCOUNT_RE = /Your Account Number:\s*([\d\-]+)/;
const FX_RE = /1USD\s*=\s*([\d.]+)\s*CAD/;

const ASSET_CLASS_HEADERS = new Set([
  "FIXED INCOME", "COMMON SHARES", "PREFERRED SHARES",
  "FOREIGN SECURITIES", "MUTUAL FUNDS", "OTHER",
]);

// Footnote glyphs that may trail the market-value column.
const FOOTNOTE_RE = /\s*[¹²³⁴ⁿ°¤*#+]\s*$/u;

// Matches the "DUE MM/DD/YYYY R.RRR%" suffix on bond continuation lines.
const DUE_RE = /\bDUE\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+\.\d+)%/;

// A row is identified by its terminal "$NN,NNN.NN" token (optionally followed by a footnote).
const MV_RE = /\$([\d,]+\.\d{2})$/;

// Two-token activities listed first so the matcher prefers the longer form.
const ACTIVITY_TWO_TOKEN = ["WIRE TFR", "DISTRIB."];
const ACTIVITY_ONE_TOKEN = [
  "DIVIDEND", "INTEREST", "FEE", "HST", "SOLD", "BOUGHT",
  "WITHDRAW", "DEPOSIT", "CHEQUE", "ADJUST",
];

// Activities whose recorded amount goes in the DEBIT column.
const DEBIT_ACTIVITIES = new Set(["FEE", "HST", "BOUGHT", "WIRE TFR", "WITHDRAW", "CHEQUE"]);
// Activities whose recorded amount goes in the CREDIT column.
const CREDIT_ACTIVITIES = new Set(["DIVIDEND", "INTEREST", "SOLD", "DEPOSIT"]);
// Activities that produce no cash-flow row (informational only).
const SKIP_ACTIVITIES = new Set(["DISTRIB.", "ADJUST"]);

const DATE_PREFIX_RE = /^([A-Z]+)\.?\s+(\d{1,2})\s+(.+)$/;

function parseActivityDate(monStr, dayStr, year) {
  const mm = MONTHS[monStr];
  if (!mm) return null;
  return `${year}-${mm}-${dayStr.padStart(2, "0")}`;
}

// Matches a numeric token (with commas, optional minus sign).
function isActivityNumeric(tok) {
  return /^-?[\d,]+(\.\d+)?-?$/.test(tok);
}

function parseMoney(tok) {
  return parseFloat(String(tok).replace(/[,$]/g, ""));
}

function parseActivity(text, asOfDate) {
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === "ACCOUNT ACTIVITY"
                                       || l.trim().startsWith("ACCOUNT ACTIVITY"));
  if (startIdx === -1) return [];

  const year = asOfDate.slice(0, 4);
  const rows = [];
  let current = null;
  const flush = () => { if (current) { rows.push(current); current = null; } };

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/Opening Balance|Closing Balance/.test(line)) { flush(); continue; }
    // Skip the "DATE ACTIVITY DESCRIPTION" column-header line and similar
    if (/^QUANTITY .*RATE/.test(line) || /^DATE\s+ACTIVITY/.test(line)) continue;
    // Skip the page-footer continued-on-next-page line
    if (line.includes("CONTINUED ON NEXT PAGE")) continue;
    // Skip the page header repeats (RBC Dominion Securities Inc. etc.)
    if (/^RBC Dominion Securities Inc\./.test(line)) continue;
    if (/^Your Account Number:/.test(line)) continue;
    if (line === "CANADIAN DOLLAR" || line === "U.S. DOLLAR" || line === "A + STATEMENT") continue;
    if (/^\d{4}$/.test(line)) continue;                   // year alone
    if (/^_{5,}/.test(line)) continue;                    // underline separators

    // Try to match a new activity row by date prefix.
    const m = line.match(DATE_PREFIX_RE);
    if (m) {
      const date = parseActivityDate(m[1], m[2], year);
      const rest = m[3];
      // Try the two-token activities first.
      let activity = null;
      let restAfter = null;
      for (const at of ACTIVITY_TWO_TOKEN) {
        if (rest.startsWith(at + " ")) {
          activity = at;
          restAfter = rest.slice(at.length).trim();
          break;
        }
      }
      if (!activity) {
        for (const at of ACTIVITY_ONE_TOKEN) {
          if (rest.startsWith(at + " ")) {
            activity = at;
            restAfter = rest.slice(at.length).trim();
            break;
          }
        }
      }
      if (!activity) {
        // Could not identify the activity token - treat as a continuation of the previous row.
        if (current) current.description = (current.description + " " + line).trim();
        continue;
      }
      flush();

      if (SKIP_ACTIVITIES.has(activity)) {
        // DISTRIB. and similar - no cash impact; don't open a row.
        current = null;
        continue;
      }

      // Pull trailing numerics off the right end.
      const tokens = restAfter.split(/\s+/);
      const numerics = [];
      while (tokens.length && isActivityNumeric(tokens[tokens.length - 1])) {
        numerics.unshift(tokens.pop());
      }
      // Description is everything left in tokens.
      const description = tokens.join(" ");
      if (numerics.length === 0) {
        // No amount on the row - skip it.
        current = null;
        continue;
      }
      const amount = parseMoney(numerics[numerics.length - 1]);
      let debit = 0, credit = 0;
      if (DEBIT_ACTIVITIES.has(activity)) debit = Math.abs(amount);
      else if (CREDIT_ACTIVITIES.has(activity)) credit = Math.abs(amount);

      current = { date, activity, description, debit, credit };
    } else if (current) {
      // Continuation line - append to description.
      current.description = (current.description + " " + line).trim();
    }
  }
  flush();
  return rows;
}

function parseDate(text) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(/^([A-Z]+)\.?\s+(\d{1,2})$/);
    if (!m) continue;
    const monthKey = m[1];
    const mm = MONTHS[monthKey];
    if (!mm) continue;
    const yearMatch = lines[i + 1].match(/^(\d{4})$/);
    if (!yearMatch) continue;
    return `${yearMatch[1]}-${mm}-${m[2].padStart(2, "0")}`;
  }
  return null;
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

// Scan lines[fromIdx..fromIdx+4) for a "DUE MM/DD/YYYY R.RRR%" continuation line.
// Returns " DUE MM/DD/YYYY R.RRR%" if found, or null.  Stops early when it hits a
// line that clearly belongs to a new holding or a section boundary.
function findBondDuePart(lines, fromIdx) {
  for (let j = fromIdx; j < Math.min(fromIdx + 4, lines.length); j++) {
    const candidate = lines[j].trim();
    if (!candidate) continue;
    // Stop scanning when we reach a section header.
    if (ASSET_CLASS_HEADERS.has(candidate)) return null;
    if (candidate.startsWith("Total Value of")) return null;
    if (candidate === "ACCOUNT ACTIVITY") return null;
    // A line ending in $amount is a new holding row, not a continuation.
    if (/\$[\d,]+\.\d{2}/.test(candidate)) return null;
    const m = candidate.match(DUE_RE);
    if (m) return ` DUE ${m[1]} ${m[2]}%`;
  }
  return null;
}

function parseHoldings(text) {
  const lines = text.split("\n");
  const holdings = [];
  let currentProductType = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
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

    let nameOut = row.name;
    if (currentProductType === "FIXED INCOME") {
      const duePart = findBondDuePart(lines, i + 1);
      if (duePart) nameOut += duePart;
    }
    holdings.push({ ...row, name: nameOut, productType: currentProductType });
  }
  return holdings;
}

function parseStatement({ currency, text }) {
  const accountMatch = text.match(ACCOUNT_RE);
  if (!accountMatch) throw new Error("parseStatement: account number not found");
  const accountNumber = normalizeAccountNumber(accountMatch[1]);

  const asOfDate = parseDate(text);
  if (!asOfDate) throw new Error("parseStatement: statement date not found");

  const fxMatch = text.match(FX_RE);
  const fxRate = fxMatch ? parseFloat(fxMatch[1]) : null;

  const holdings = parseHoldings(text);
  const activity = parseActivity(text, asOfDate);

  return { accountNumber, asOfDate, currency, fxRate, holdings, activity };
}

module.exports = { parseStatement, parseHoldings, parseHoldingRow };
