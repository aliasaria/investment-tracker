const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectFileType } = require("../lib/file-detect");

test("detects PDF by %PDF magic bytes", () => {
  const buf = Buffer.from("%PDF-1.4\n...");
  assert.equal(detectFileType(buf, "anything.pdf"), "pdf");
});

test("detects holdings CSV by header", () => {
  const buf = Buffer.from("As of,Account,Symbol,Total Value\n2025-01-01,A,X,100");
  assert.equal(detectFileType(buf, "h.csv"), "holdings");
});

test("detects activity CSV by header", () => {
  const buf = Buffer.from("Date,Account,Activity,Value\n2025-01-01,A,Deposits,100");
  assert.equal(detectFileType(buf, "a.csv"), "activity");
});

test("returns 'unknown' for garbage", () => {
  const buf = Buffer.from("hello world");
  assert.equal(detectFileType(buf, "x.txt"), "unknown");
});
