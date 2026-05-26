const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitAccountField, normalizeAccountNumber } = require("../lib/account-id");

test("splits 'NNNN - Nickname' into account number and nickname", () => {
  const result = splitAccountField("12345678 - Joint");
  assert.deepEqual(result, { accountNumber: "12345678", nickname: "Joint" });
});

test("trims surrounding whitespace and preserves spaces inside nickname", () => {
  const result = splitAccountField("  12345678 - RRSP - Joe  ");
  assert.deepEqual(result, { accountNumber: "12345678", nickname: "RRSP - Joe" });
});

test("accepts hyphenated account numbers like '111-22222-3-4'", () => {
  const result = splitAccountField("111-22222-3-4 - Sample Trust");
  assert.deepEqual(result, { accountNumber: "11122222", nickname: "Sample Trust" });
});

test("throws on missing dash separator", () => {
  assert.throws(() => splitAccountField("12345678"), /malformed/i);
});

test("throws on empty input", () => {
  assert.throws(() => splitAccountField(""), /malformed/i);
  assert.throws(() => splitAccountField(null), /malformed/i);
});

test("throws when nickname is empty after the dash", () => {
  assert.throws(() => splitAccountField("12345678 - "), /malformed/i);
});

test("normalizeAccountNumber strips hyphens and truncates to 8 digits", () => {
  assert.equal(normalizeAccountNumber("370-77301-1-9"), "37077301");
  assert.equal(normalizeAccountNumber("12345678"), "12345678");
  assert.equal(normalizeAccountNumber("  12-34-56-78 "), "12345678");
});

test("normalizeAccountNumber leaves shorter IDs alone", () => {
  assert.equal(normalizeAccountNumber("1234567"), "1234567");
  assert.equal(normalizeAccountNumber("12-345"), "12345");
});

test("splitAccountField normalizes the account-number side", () => {
  const { accountNumber, nickname } = splitAccountField("111-22222-3-4 - Sample Trust");
  assert.equal(accountNumber, "11122222");
  assert.equal(nickname, "Sample Trust");
});
