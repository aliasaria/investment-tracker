const { test } = require("node:test");
const assert = require("node:assert/strict");
const { extractPdfText } = require("../lib/pdf-extract");

// Generate a tiny PDF at test time using a known-good template that pdf-parse can read.
// We do NOT ship a binary fixture (PII policy + binary file). All test content fabricated.
function makeTinyPdf(textLines) {
  const stream = `BT /F1 12 Tf 50 750 Td ${textLines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const content = Buffer.from(stream, "latin1");
  const objs = [];
  objs.push("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj");
  objs.push("2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj");
  objs.push("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj");
  objs.push(`4 0 obj<</Length ${content.length}>>stream\n${content.toString("latin1")}\nendstream endobj`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) { offsets.push(pdf.length); pdf += o + "\n"; }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

test("extracts text from a fabricated PDF", async () => {
  const buf = makeTinyPdf(["HELLO WORLD", "LINE TWO"]);
  const result = await extractPdfText(buf);
  assert.ok(typeof result.text === "string");
  assert.ok(result.text.includes("HELLO WORLD"), `expected HELLO WORLD in: ${JSON.stringify(result.text)}`);
  assert.ok(result.text.includes("LINE TWO"), `expected LINE TWO in: ${JSON.stringify(result.text)}`);
  assert.equal(typeof result.pageCount, "number");
  assert.ok(result.pageCount >= 1);
});

test("strips per-page footer markers like '-- 1 of N --'", async () => {
  const buf = makeTinyPdf(["HELLO WORLD"]);
  const result = await extractPdfText(buf);
  assert.ok(!/-- \d+ of \d+ --/.test(result.text),
    `page-footer marker should be stripped; got: ${JSON.stringify(result.text)}`);
});

test("rejects non-PDF buffers", async () => {
  await assert.rejects(() => extractPdfText(Buffer.from("not a pdf")));
});

test("rejects non-Buffer input", async () => {
  await assert.rejects(() => extractPdfText("a string"), /Buffer/);
});
