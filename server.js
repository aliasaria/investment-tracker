// server.js — express bootstrap and route wiring only.
const { exec } = require("child_process");
const express = require("express");
const path = require("path");
const cors = require("cors");
const YahooFinance = require("yahoo-finance2").default;

const { buildRouter: buildUploadRouter } = require("./routes/upload");
const dataRouter = require("./routes/data");
const uploadsRouter = require("./routes/uploads");
const { buildRouter: buildBenchmarksRouter } = require("./routes/benchmarks");
const freshnessRouter = require("./routes/freshness");
const cashflowsRouter = require("./routes/cashflows");

const yahooFinance = new YahooFinance();
const app = express();
const port = 3000;

app.use(cors());
// API routes first — must precede express.static so paths like /uploads
// aren't intercepted by the static middleware (uploads/ exists as a directory).
app.use(buildUploadRouter({ yahooFinance }));
app.use(dataRouter);
app.use(uploadsRouter);
app.use(buildBenchmarksRouter({ yahooFinance }));
app.use(freshnessRouter);
app.use(cashflowsRouter);
// Then static + the root HTML fallback.
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(port, () => {
  console.log(`Investment Tracker running at http://localhost:${port}`);
  exec(`open http://localhost:${port}`);
});
