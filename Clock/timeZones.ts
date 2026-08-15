// The zone list and offset arithmetic behind the clock's time zone picker.

// Every zone the browser knows, which on a current engine is the whole IANA database (~400 entries).
// `Intl.supportedValuesOf` only landed in Safari 15.4 though, and this board is also read on an old
// iPad — so older engines get the list below instead: one place per offset the board is realistically
// set to, rather than a stale copy of the database.
const FALLBACK_TIME_ZONES = [
  "Pacific/Midway",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Bogota",
  "America/Caracas",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Atlantic/Azores",
  "UTC",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Zurich",
  "Europe/Warsaw",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Kyiv",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Jerusalem",
  "Asia/Riyadh",
  "Asia/Tehran",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Ho_Chi_Minh",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Australia/Perth",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Pacific/Guam",
  "Pacific/Noumea",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Apia",
];

export type ZoneOption = {
  // IANA id. The picker also renders a row with an empty id, meaning "follow the device".
  zone: string;
  city: string;
  region: string;
  offsetMinutes: number;
  offsetLabel: string;
  // Pre-lowercased haystack the search box matches against.
  search: string;
};

export function listTimeZones(): string[] {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  if (typeof supportedValuesOf === "function") {
    try {
      const zones = supportedValuesOf.call(Intl, "timeZone");
      if (Array.isArray(zones) && zones.length) return zones;
    } catch {
      // An engine that has the method but not the "timeZone" key falls through to the list above.
    }
  }
  return FALLBACK_TIME_ZONES;
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validTimeZone(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return undefined;
  }
}

// How far the zone is from UTC right now, DST included. Reading the zone's wall clock back as if it
// were a UTC instant and diffing turns "what time is it there" into the offset — which is the only
// way to get it on engines that predate `timeZoneName: "shortOffset"` (Safari 15.4 again).
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wallClock = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"));
  // Offsets are whole minutes, so the instant is truncated to the minute the parts were read at.
  return Math.round((wallClock - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// "America/Argentina/Buenos_Aires" reads as Buenos Aires, under America / Argentina.
export function splitZone(zone: string): { city: string; region: string } {
  const segments = zone.split("/");
  const city = (segments.pop() ?? zone).replace(/_/g, " ");
  return { city, region: segments.join(" / ") };
}

// Built fresh each time the picker opens: the offsets are the ones in force right now, so a zone
// that has just moved on or off DST is never listed an hour out.
export function buildZoneOptions(at: Date): ZoneOption[] {
  const options: ZoneOption[] = [];
  for (const zone of listTimeZones()) {
    let offsetMinutes: number;
    try {
      offsetMinutes = zoneOffsetMinutes(zone, at);
    } catch {
      // A zone the list names but this engine can't format is simply not offered.
      continue;
    }
    const { city, region } = splitZone(zone);
    const offsetLabel = formatOffset(offsetMinutes);
    options.push({
      zone,
      city,
      region,
      offsetMinutes,
      offsetLabel,
      search: `${zone.replace(/_/g, " ")} ${region} ${offsetLabel}`.toLowerCase(),
    });
  }
  // Offset first is what makes the list scannable — the column of UTC±hh:mm reads as a scale, and
  // the cities sharing an offset sit together on it.
  options.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city));
  return options;
}
