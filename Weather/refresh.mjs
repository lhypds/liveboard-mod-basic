#!/usr/bin/env node
// Builds the monthly mean-temperature history that the card's "warmer/colder than this month"
// comparison is measured against, for every location in location.txt, and writes it to
// data/monthly-mean-temp.json — read statically by the frontend (see api.ts's
// monthlyNormalsFromFile), so the browser makes no Wolfram calls of its own.
//
// Wolfram|Alpha's Short Answers API only answers one month of one year at a time ("average
// temperature in Tokyo in July 2019"), and it cannot do multi-year ranges, so a NORMALS_YEARS
// climatology costs NORMALS_YEARS × 12 queries per location. That is only paid once: every
// answer is kept in the JSON and later runs fetch nothing but the gaps — a new complete year
// adds 12 queries, and a run with nothing missing spends zero.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const locationsPath = join(here, "location.txt");
const dataDir = join(here, "data");
const dataPath = join(dataDir, "monthly-mean-temp.json");

// Keep in sync with NORMALS_YEARS in api.ts — the frontend averages this same window.
const NORMALS_YEARS = 10;
const CONCURRENCY = 4;
// Guards the free tier (2,000 calls/month) if location.txt ever grows a long list: anything over
// the cap is simply left for the next run, since the data file accumulates across runs.
const MAX_QUERIES_PER_RUN = 200;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseLocations(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

// Returns °C, or null when Wolfram knows the place but has no record for that month — nulls are
// stored so settled gaps are not re-queried on every run. Throws on anything transient
// (network/HTTP/unparseable), leaving the month absent so the next run retries it.
async function fetchMonthlyMean(location, year, month, appId) {
  const url = new URL("https://api.wolframalpha.com/v1/result");
  url.searchParams.set("appid", appId);
  url.searchParams.set("i", `average temperature in ${location} in ${MONTH_NAMES[month - 1]} ${year}`);
  url.searchParams.set("units", "metric");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (/unavailable/i.test(text)) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*degrees?\s*(celsius|fahrenheit)/i);
  if (!match) throw new Error(`could not parse response: ${text}`);
  const value = Number(match[1]);
  return match[2].toLowerCase().startsWith("c") ? value : ((value - 32) * 5) / 9;
}

async function readExistingData() {
  try {
    return JSON.parse(await readFile(dataPath, "utf-8"));
  } catch {
    return {};
  }
}

function sortDeep(data) {
  return Object.fromEntries(
    Object.keys(data)
      .sort()
      .map((location) => [
        location,
        Object.fromEntries(Object.keys(data[location]).sort().map((month) => [month, data[location][month]])),
      ]),
  );
}

async function main() {
  const appId = process.env.WOLFRAM_ALPHA_APPID;
  if (!appId) {
    console.error("WOLFRAM_ALPHA_APPID is not set — skipping monthly-mean-temp refresh.");
    process.exit(1);
  }

  const locations = parseLocations(await readFile(locationsPath, "utf-8"));
  const data = await readExistingData();

  // Only complete past years: the current year is still in progress, and a half-finished month
  // would bias the climatology towards whichever part of it has already happened.
  const endYear = new Date().getFullYear() - 1;
  const startYear = endYear - (NORMALS_YEARS - 1);

  const pending = [];
  for (const location of locations) {
    const key = location.toLowerCase();
    data[key] ??= {};
    for (let year = startYear; year <= endYear; year++) {
      for (let month = 1; month <= 12; month++) {
        if (!(monthKey(year, month) in data[key])) pending.push({ location, key, year, month });
      }
    }
  }

  const deferred = pending.length - Math.min(pending.length, MAX_QUERIES_PER_RUN);
  const queue = pending.slice(0, MAX_QUERIES_PER_RUN);
  console.log(
    `${locations.length} location(s), ${startYear}–${endYear}: ${queue.length} month(s) to fetch` +
      (deferred ? `, ${deferred} deferred to the next run (cap ${MAX_QUERIES_PER_RUN})` : ""),
  );

  let failures = 0;
  await mapWithConcurrency(queue, CONCURRENCY, async ({ location, key, year, month }) => {
    try {
      const value = await fetchMonthlyMean(location, year, month, appId);
      data[key][monthKey(year, month)] = value;
      console.log(`${location} ${monthKey(year, month)}: ${value == null ? "unavailable" : `${value}°C`}`);
    } catch (err) {
      failures += 1;
      console.error(`${location} ${monthKey(year, month)}: failed (${err.message}) — will retry next run`);
    }
  });

  await mkdir(dataDir, { recursive: true });
  await writeFile(dataPath, JSON.stringify(sortDeep(data), null, 2) + "\n");
  console.log(`Wrote ${dataPath}${failures ? ` (${failures} month(s) failed)` : ""}`);
}

main();
