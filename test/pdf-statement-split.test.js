const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitSubStatements } = require("../lib/pdf-statement-split");

test("splits text containing both CAD and USD sub-statements", () => {
  const text = [
    "CANADIAN DOLLAR",
    "A + STATEMENT",
    "APR. 30 2025",
    "...cad content...",
    "U.S. DOLLAR",
    "A + STATEMENT",
    "APR. 30 2025",
    "...usd content...",
  ].join("\n");
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 2);
  assert.equal(subs[0].currency, "CAD");
  assert.ok(subs[0].text.includes("cad content"));
  assert.equal(subs[1].currency, "USD");
  assert.ok(subs[1].text.includes("usd content"));
});

test("returns a single sub-statement when only one currency present", () => {
  const text = "CANADIAN DOLLAR\nA + STATEMENT\n...cad only...";
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].currency, "CAD");
});

test("only the FIRST CAD header anchors the CAD chunk (per-page header repeats are ignored)", () => {
  const text = [
    "CANADIAN DOLLAR",
    "A + STATEMENT",
    "page 1 cad content",
    "CANADIAN DOLLAR",   // per-page header repeat
    "A + STATEMENT",
    "page 2 cad content",
    "U.S. DOLLAR",
    "A + STATEMENT",
    "page 1 usd content",
    "U.S. DOLLAR",       // per-page header repeat
    "A + STATEMENT",
    "page 2 usd content",
  ].join("\n");
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 2);
  // CAD chunk contains both 'page 1 cad' and 'page 2 cad'
  assert.ok(subs[0].text.includes("page 1 cad content"));
  assert.ok(subs[0].text.includes("page 2 cad content"));
  // USD chunk contains both 'page 1 usd' and 'page 2 usd'
  assert.ok(subs[1].text.includes("page 1 usd content"));
  assert.ok(subs[1].text.includes("page 2 usd content"));
});

test("throws when no sub-statement markers found", () => {
  assert.throws(() => splitSubStatements("garbage with no statement markers"), /no sub-statement/i);
});

test("recognizes PIM TFSA (Cdn $) header as CAD sub-statement", () => {
  const text = "Statement of Your Account\nPIM TFSA (Cdn $)\nNOV. 28\n2025\n...tfsa content...";
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].currency, "CAD");
  assert.ok(subs[0].text.includes("tfsa content"));
});

test("recognizes PIM RRSP (Cdn $) header as CAD sub-statement", () => {
  const text = "Statement of Your Account\nPIM RRSP (Cdn $)\nNOV. 28\n2025\n...rrsp content...";
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].currency, "CAD");
});

test("recognizes PIM RRSP (U.S. $) header as USD sub-statement", () => {
  const text = "Statement of Your Account\nPIM RRSP (U.S. $)\nNOV. 28\n2025\n...usd content...";
  const subs = splitSubStatements(text);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].currency, "USD");
});
