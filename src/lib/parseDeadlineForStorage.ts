/**
 * Converts admin deadline form input to a UTC ISO string for `timestamptz`.
 *
 * Naive `YYYY-MM-DDTHH:mm` / `:ss` strings are interpreted as wall time in
 * `ianaTimeZone` (the admin's chosen deadline timezone). Values already
 * carrying a `Z` / offset are parsed as absolute instants. Server actions run
 * in UTC, so callers must not rely on `new Date(naive)` on the server.
 */

const NAIVE_LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function zonedWallClockToParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === t)?.value);
  return {
    y: n("year"),
    mo: n("month"),
    d: n("day"),
    h: n("hour"),
    mi: n("minute"),
    s: n("second"),
  };
}

function cmpWall(
  a: ReturnType<typeof zonedWallClockToParts>,
  b: ReturnType<typeof zonedWallClockToParts>,
): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.mo !== b.mo) return a.mo - b.mo;
  if (a.d !== b.d) return a.d - b.d;
  if (a.h !== b.h) return a.h - b.h;
  if (a.mi !== b.mi) return a.mi - b.mi;
  return a.s - b.s;
}

/**
 * Map calendar + clock in `timeZone` to UTC epoch ms via binary search.
 */
function naiveLocalDateTimeToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const target = { y, mo, d, h, mi, s };
  let lo = Date.UTC(y, mo - 1, d, h, mi, s) - 48 * 60 * 60 * 1000;
  let hi = Date.UTC(y, mo - 1, d, h, mi, s) + 48 * 60 * 60 * 1000;

  for (let i = 0; i < 40 && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const wall = zonedWallClockToParts(mid, timeZone);
    if (cmpWall(wall, target) < 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  for (let ms = hi - 2000; ms <= hi + 2000; ms += 1000) {
    const wall = zonedWallClockToParts(ms, timeZone);
    if (cmpWall(wall, target) === 0) return ms;
  }

  throw new Error("Could not resolve deadline in the given time zone.");
}

export function parseDeadlineForStorage(
  raw: string,
  ianaTimeZone: string | null,
): string | null {
  const v = raw.trim();
  if (!v) return null;

  if (NAIVE_LOCAL_DATETIME.test(v)) {
    const m = NAIVE_LOCAL_DATETIME.exec(v)!;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const s = m[6] != null ? Number(m[6]) : 0;
    const tz = (ianaTimeZone ?? "").trim() || "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    } catch {
      throw new Error("Invalid time zone.");
    }
    const ms = naiveLocalDateTimeToUtcMs(y, mo, d, h, mi, s, tz);
    return new Date(ms).toISOString();
  }

  const instant = new Date(v);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Invalid deadline timestamp.");
  }
  return instant.toISOString();
}

/**
 * UTC instant → `YYYY-MM-DDTHH:mm` as wall clock in `timeZone`, for
 * `<input type="datetime-local">` when that zone is not necessarily the
 * browser's local zone.
 */
export function instantToDatetimeLocalInZone(
  isoUtc: string,
  timeZone: string,
): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(d);
  } catch {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((x) => x.type === t)?.value ?? "";
  const y = p("year");
  const mo = p("month");
  const day = p("day");
  const h = p("hour");
  const mi = p("minute");
  if (!y || !mo || !day || h === "" || mi === "") return "";
  return `${y}-${mo}-${day}T${h}:${mi}`;
}
