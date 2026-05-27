// test/db-backup.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { backupDatabase } = require("../lib/db-backup");

test("backupDatabase copies db into backups/YYYY/MM/ with timestamped name", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  fs.writeFileSync(path.join(projectRoot, "investments.db"), "sqlite-bytes");

  const relPath = backupDatabase({
    uploadTimestamp: "2026-05-24T12:30:00.000Z",
    projectRoot,
  });

  assert.match(relPath, /^backups\/2026\/05\/investments-2026-05-24T12-30-00-000Z\.db$/);
  const absPath = path.join(projectRoot, relPath);
  assert.ok(fs.existsSync(absPath), "backup file must exist");
  assert.equal(fs.readFileSync(absPath, "utf8"), "sqlite-bytes");
  assert.ok(fs.existsSync(path.join(projectRoot, "investments.db")), "source must remain");
});

test("backupDatabase returns null when no db file exists yet", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  const relPath = backupDatabase({
    uploadTimestamp: "2026-05-24T12:30:00.000Z",
    projectRoot,
  });
  assert.equal(relPath, null);
  assert.ok(!fs.existsSync(path.join(projectRoot, "backups")), "no backup dir created");
});
