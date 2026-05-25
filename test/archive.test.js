// test/archive.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { archiveUpload } = require("../lib/archive");

test("archiveUpload moves file to uploads/archive/YYYY/MM/<ts>__<name>", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
  const srcPath = path.join(tmpDir, "upload-12345");
  fs.writeFileSync(srcPath, "header1,header2\nfoo,bar\n");

  // Use a temp project root so the test does not pollute the real uploads/archive.
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-"));

  const archivePath = await archiveUpload({
    srcPath,
    originalFilename: "ExportedFile_20260524123000.csv",
    uploadTimestamp: "2026-05-24T12:30:00.000Z",
    projectRoot,
  });

  // Expected path: uploads/archive/2026/05/2026-05-24T12-30-00-000Z__ExportedFile_20260524123000.csv
  assert.match(archivePath, /^uploads\/archive\/2026\/05\/[\w.-]+__ExportedFile_20260524123000\.csv$/);
  assert.ok(fs.existsSync(path.join(projectRoot, archivePath)), "destination must exist");
  assert.ok(!fs.existsSync(srcPath), "source must be removed");
  assert.equal(
    fs.readFileSync(path.join(projectRoot, archivePath), "utf8"),
    "header1,header2\nfoo,bar\n",
  );
});

test("archiveUpload sanitizes the original filename", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-test-"));
  const srcPath = path.join(tmpDir, "upload-99");
  fs.writeFileSync(srcPath, "x");
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-"));

  const archivePath = await archiveUpload({
    srcPath,
    originalFilename: "../../etc/passwd",
    uploadTimestamp: "2026-05-24T12:30:00.000Z",
    projectRoot,
  });

  assert.ok(!archivePath.includes(".."), "must not contain path traversal");
  assert.ok(fs.existsSync(path.join(projectRoot, archivePath)));
});
