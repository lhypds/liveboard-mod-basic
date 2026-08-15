// Same source and cache policy as the Currency Calc component.
// Frankfurter exposes ECB reference rates without an API key.
const API_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const TTL_MS = 60 * 60 * 1000;

export type RatesData = {
  base: string;
  date: string;
  rates: Record<string, number>;
  fetchedAt: number;
};

export async function fetchRates(): Promise<RatesData> {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error(`Rate fetch failed: HTTP ${response.status}`);
  const data = (await response.json()) as { base: string; date: string; rates: Record<string, number> };
  return {
    base: data.base,
    date: data.date,
    rates: { ...data.rates, [data.base]: 1 },
    fetchedAt: Date.now(),
  };
}

export function convert(amount: number, fromCode: string, toCode: string, rates: Record<string, number>): number | null {
  if (fromCode === toCode) return amount;
  const fromRate = rates[fromCode];
  const toRate = rates[toCode];
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate === 0) return null;
  return (amount / fromRate) * toRate;
}

export function trimRates(data: RatesData, codes: string[]): RatesData {
  const rates: Record<string, number> = {};
  for (const code of codes) {
    if (typeof data.rates[code] === "number") rates[code] = data.rates[code];
  }
  return { base: data.base, date: data.date, fetchedAt: data.fetchedAt, rates };
}

export function readStoredRates(stored: unknown, codes: string[]): RatesData | null {
  const data = stored as RatesData | undefined;
  if (!data || typeof data.fetchedAt !== "number" || typeof data.base !== "string") return null;
  if (typeof data.date !== "string" || typeof data.rates !== "object" || data.rates === null) return null;
  if (Date.now() - data.fetchedAt > TTL_MS) return null;
  if (!codes.every((code) => typeof data.rates[code] === "number")) return null;
  return data;
}

export function sameStoredRates(stored: unknown, next: RatesData): boolean {
  const data = stored as RatesData | undefined;
  if (!data || data.fetchedAt !== next.fetchedAt || data.base !== next.base || data.date !== next.date) return false;
  const codes = Object.keys(next.rates);
  return (
    Object.keys(data.rates ?? {}).length === codes.length &&
    codes.every((code) => data.rates[code] === next.rates[code])
  );
}
