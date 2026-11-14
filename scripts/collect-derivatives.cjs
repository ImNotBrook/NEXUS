#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const buildRoot = path.resolve(__dirname, "../.cache/derivatives-build");
const {
  fetchBybitFundingHistory,
  fetchBybitOpenInterest,
  fetchBybitAccountRatio,
} = require(path.join(buildRoot, "adapters/bybit-derivatives.js"));
const { mergeStoredDerivativesHistory } = require(path.join(buildRoot, "domain/derivatives-ledger.js"));

const OUTPUT_ROOT = path.resolve(process.argv[2] || "data/derivatives");
const SYMBOLS = (process.env.BYBIT_SYMBOLS || "BTCUSDT,ETHUSDT,SOLUSDT")
  .split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
const CATEGORY = "linear";
const RETENTION_DAYS = 365;
const PAGE_LIMIT = 200;

function apiFetcher(input, init) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

async function readExisting(filePath, expected) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const document = JSON.parse(raw);
    if (document.schemaVersion !== 1 || document.provider !== "bybit" ||
        document.symbol !== expected.symbol || document.category !== expected.category ||
        document.metric !== expected.metric || !Array.isArray(document.observations)) {
      throw new Error("Existing derivatives ledger file has an incompatible schema or series identity");
    }
    return document.observations;
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = filePath + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temporary, filePath);
}

async function collectSeries(symbol, metric, fetchObservations, now, cutoff) {
  const expected = { provider: "bybit", symbol, category: CATEGORY, metric };
  const filePath = path.join(OUTPUT_ROOT, "bybit", symbol, CATEGORY, metric + ".json");
  const existing = await readExisting(filePath, expected);
  const incoming = await fetchObservations();
  if (!Array.isArray(incoming) || incoming.length === 0) {
    throw new Error("Provider returned no " + metric + " observations");
  }
  const merged = mergeStoredDerivativesHistory(existing, incoming, cutoff, now);
  const document = {
    schemaVersion: 1,
    provider: "bybit",
    symbol,
    category: CATEGORY,
    metric,
    updatedAt: now,
    retentionDays: RETENTION_DAYS,
    observations: merged,
  };
  await writeAtomic(filePath, document);
  return {
    status: "success",
    symbol,
    metric,
    received: incoming.length,
    retained: merged.length,
    firstTimestamp: incoming.reduce((value, item) => Math.min(value, item.timestamp), Number.MAX_SAFE_INTEGER),
    lastTimestamp: incoming.reduce((value, item) => Math.max(value, item.timestamp), 0),
  };
}

async function main() {
  const now = Date.now();
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const report = {
    schemaVersion: 1,
    provider: "bybit",
    category: CATEGORY,
    collectedAt: now,
    retentionDays: RETENTION_DAYS,
    results: [],
  };

  for (const symbol of SYMBOLS) {
    const tasks = [
      ["funding_rate", () => fetchBybitFundingHistory({
        symbol, category: CATEGORY, limit: PAGE_LIMIT,
      }, apiFetcher)],
      ["open_interest", async () => (await fetchBybitOpenInterest({
        symbol, category: CATEGORY, intervalTime: "1h", limit: PAGE_LIMIT,
      }, apiFetcher)).observations],
      ["account_ratio", () => fetchBybitAccountRatio({
        symbol, category: CATEGORY, period: "1h", limit: PAGE_LIMIT,
      }, apiFetcher)],
    ];

    for (const [metric, fetchObservations] of tasks) {
      try {
        report.results.push(await collectSeries(symbol, metric, fetchObservations, now, cutoff));
      } catch (error) {
        report.results.push({
          status: "error",
          symbol,
          metric,
          error: error instanceof Error ? error.message : "Unknown collection error",
        });
      }
    }
  }

  await writeAtomic(path.join(OUTPUT_ROOT, "collection-report.json"), report);
  const successes = report.results.filter((item) => item.status === "success").length;
  const failures = report.results.length - successes;
  process.stdout.write(JSON.stringify({ successes, failures, report: path.join(OUTPUT_ROOT, "collection-report.json") }) + "\n");
  if (successes === 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
