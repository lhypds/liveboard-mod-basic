#!/usr/bin/env node
// Fetches the Wolfram|Alpha annual mean temperature for each location in location.txt
// and writes the result to data/annual-mean-temp.json, which the frontend reads statically
// (see api.ts's fetchAnnualMeanTemp) — no live server calls from the browser.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const locationsPath = join(here, "location.txt");
const dataDir = join(here, "data");
const dataPath = join(dataDir, "annual-mean-temp.json");

function parseLocations(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function fetchAnnualMeanTemp(location, appId) {
  const url = new URL("https://api.wolframalpha.com/v1/result");
  url.searchParams.set("appid", appId);
  url.searchParams.set("i", `annual mean temperature in ${location}`);
  url.searchParams.set("units", "metric");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*degrees?\s*(celsius|fahrenheit)/i);
  if (!match) throw new Error(`could not parse response: ${text}`);
  return { value: Number(match[1]), unit: match[2].toLowerCase().startsWith("c") ? "C" : "F" };
}

async function readExistingData() {
  try {
    return JSON.parse(await readFile(dataPath, "utf-8"));
  } catch {
    return {};
  }
}

async function main() {
  const appId = process.env.WOLFRAM_ALPHA_APPID;
  if (!appId) {
    console.error("WOLFRAM_ALPHA_APPID is not set — skipping annual-mean-temp refresh.");
    process.exit(1);
  }

  const locations = parseLocations(await readFile(locationsPath, "utf-8"));
  const data = await readExistingData();

  for (const location of locations) {
    const key = location.toLowerCase();
    try {
      data[key] = await fetchAnnualMeanTemp(location, appId);
      console.log(`${location}: ${data[key].value}°${data[key].unit}`);
    } catch (err) {
      console.error(`${location}: failed to refresh (${err.message}) — keeping previous value`);
    }
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(dataPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${dataPath}`);
}

main();
