// test/csv-detect.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectCsvType } = require("../lib/csv-detect");

test("detects holdings CSV by 'Total Value' header", () => {
  const headers = ["As of", "Account", "Symbol", "Total Value"];
  assert.equal(detectCsvType(headers), "holdings");
});

test("detects activity CSV by 'Activity' header", () => {
  const headers = ["Date", "Activity", "Symbol", "Value", "Description"];
  assert.equal(detectCsvType(headers), "activity");
});

test("returns 'unknown' when neither marker present", () => {
  const headers = ["Foo", "Bar"];
  assert.equal(detectCsvType(headers), "unknown");
});

test("prefers holdings if both markers somehow appear", () => {
  // Defensive: if a CSV had both, holdings path is the safer non-destructive choice.
  const headers = ["Date", "Activity", "Total Value"];
  assert.equal(detectCsvType(headers), "holdings");
});

test("is tolerant of whitespace and BOM in header keys", () => {
  const headers = ["﻿As of", " Total Value ", "Account"];
  assert.equal(detectCsvType(headers), "holdings");
});

test("detects holdings CSV variant with 'Total Value(in Settlement)' header", () => {
  const headers = ["As of", "Account", "Total Value(in Settlement)", "Total Value(in CAD)"];
  assert.equal(detectCsvType(headers), "holdings");
});
