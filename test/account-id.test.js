const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitAccountField } = require("../lib/account-id");

test("splits 'NNNN - Nickname' into account number and nickname", () => {
  const result = splitAccountField("12345678 - Joint");
  assert.deepEqual(result, { accountNumber: "12345678", nickname: "Joint" });
});

test("trims surrounding whitespace and preserves spaces inside nickname", () => {
  const result = splitAccountField("  12345678 - RRSP - Joe  ");
  assert.deepEqual(result, { accountNumber: "12345678", nickname: "RRSP - Joe" });
});

test("accepts hyphenated account numbers like '370-77301-1-9'", () => {
  const result = splitAccountField("370-77301-1-9 - Family Trust");
  assert.deepEqual(result, { accountNumber: "370-77301-1-9", nickname: "Family Trust" });
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
