// lib/db-backup.js
// Snapshot investments.db into backups/YYYY/MM/ before any mutation.

const fs = require("node:fs");
const path = require("node:path");

function backupDatabase({
  uploadTimestamp,
  projectRoot = process.cwd(),
  dbFilename = "investments.db",
} = {}) {
  const srcPath = path.join(projectRoot, dbFilename);
  if (!fs.existsSync(srcPath)) return null;

  const date = new Date(uploadTimestamp);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const tsForName = uploadTimestamp.replace(/[:.]/g, "-");

  const relPath = path.join("backups", yyyy, mm, `investments-${tsForName}.db`);
  const absPath = path.join(projectRoot, relPath);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.copyFileSync(srcPath, absPath);

  return relPath.split(path.sep).join("/");
}

module.exports = { backupDatabase };
