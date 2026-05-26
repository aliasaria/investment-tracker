// lib/pdf-statement-split.js
// Splits the full extracted text of one PDF (which may bundle CAD + USD
// sub-statements back-to-back) into one chunk per currency.
//
// Three header conventions observed from RBC:
//   1. A+ managed accounts:    "CANADIAN DOLLAR" / "A + STATEMENT"
//   2. Basic accounts:         "CANADIAN DOLLAR" / "ACCOUNT STATEMENT"
//   3. PIM registered accounts (TFSA, RRSP, RIF, FHSA, etc.):
//      "Statement of Your Account" / "PIM <TYPE> (Cdn $)" or "(U.S. $)"
//
// Either header REPEATS at the top of every page within a sub-statement, so
// we only treat the FIRST occurrence of each currency as a boundary;
// subsequent matches are just page headers inside the same sub-statement.

const CURRENCY_HEADER_RE = /(CANADIAN DOLLAR|U\.S\. DOLLAR)\s*\n\s*(?:A \+ STATEMENT|ACCOUNT STATEMENT)/g;
const PIM_HEADER_RE = /Statement of Your Account\s*\n\s*PIM [^\n(]*\((Cdn|U\.S\.) \$\)/g;

function splitSubStatements(text) {
  const matches = [];
  for (const m of text.matchAll(CURRENCY_HEADER_RE)) {
    matches.push({
      currency: m[1] === "CANADIAN DOLLAR" ? "CAD" : "USD",
      start: m.index,
    });
  }
  for (const m of text.matchAll(PIM_HEADER_RE)) {
    matches.push({
      currency: m[1] === "Cdn" ? "CAD" : "USD",
      start: m.index,
    });
  }
  if (matches.length === 0) {
    throw new Error("splitSubStatements: no sub-statement headers found in text");
  }
  matches.sort((a, b) => a.start - b.start);

  // Keep only the first match per currency (subsequent ones are per-page header repeats).
  const seen = new Set();
  const firsts = [];
  for (const m of matches) {
    if (!seen.has(m.currency)) {
      seen.add(m.currency);
      firsts.push(m);
    }
  }

  return firsts.map((p, i) => {
    const end = i + 1 < firsts.length ? firsts[i + 1].start : text.length;
    return { currency: p.currency, text: text.slice(p.start, end) };
  });
}

module.exports = { splitSubStatements };
