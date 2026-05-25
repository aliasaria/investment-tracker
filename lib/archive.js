// lib/archive.js
// Moves an uploaded file from its temp location into uploads/archive/YYYY/MM/.

const fs = require("node:fs");
const path = require("node:path");

function sanitize(name) {
  // Strip path separators and parent refs; keep letters, digits, dot, dash, underscore.
  // Then collapse any sequence of dots (e.g. "..") to a single dot to prevent path traversal.
  return String(name)
    .replace(/[^\w.\-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 200);
}

async function archiveUpload({ srcPath, originalFilename, uploadTimestamp, projectRoot = process.cwd() }) {
  const date = new Date(uploadTimestamp);
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");

  const tsForName = uploadTimestamp.replace(/[:.]/g, "-");
  const safeName = sanitize(originalFilename);
  const relPath = path.join("uploads", "archive", yyyy, mm, `${tsForName}__${safeName}`);
  const absPath = path.join(projectRoot, relPath);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  // Use copy + unlink to handle cross-device moves (rename can EXDEV on some systems).
  fs.copyFileSync(srcPath, absPath);
  fs.unlinkSync(srcPath);

  return relPath.split(path.sep).join("/"); // normalize for storage
}

module.exports = { archiveUpload };
