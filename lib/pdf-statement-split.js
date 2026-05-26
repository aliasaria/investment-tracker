// lib/pdf-statement-split.js
// Splits the full extracted text of one PDF (which may bundle CAD + USD
// sub-statements back-to-back) into one chunk per currency.
//
// The header line pair "CANADIAN DOLLAR" / "A + STATEMENT" REPEATS at the top
// of every page within a sub-statement, so we only treat the FIRST occurrence
// of each currency as a boundary; subsequent matches are just page headers
// inside the same sub-statement.

const HEADER_RE = /(CANADIAN DOLLAR|U\.S\. DOLLAR)\s*\n\s*A \+ STATEMENT/g;

function splitSubStatements(text) {
  const allMatches = [...text.matchAll(HEADER_RE)];
  if (allMatches.length === 0) {
    throw new Error("splitSubStatements: no sub-statement headers found in text");
  }

  // Keep only the first match per currency.
  const seen = new Set();
  const firsts = [];
  for (const m of allMatches) {
    const currency = m[1] === "CANADIAN DOLLAR" ? "CAD" : "USD";
    if (!seen.has(currency)) {
      seen.add(currency);
      firsts.push({ currency, start: m.index });
    }
  }
  firsts.sort((a, b) => a.start - b.start);

  return firsts.map((p, i) => {
    const end = i + 1 < firsts.length ? firsts[i + 1].start : text.length;
    return { currency: p.currency, text: text.slice(p.start, end) };
  });
}

module.exports = { splitSubStatements };
