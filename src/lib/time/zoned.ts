/**
 * Wall-clock helpers for one IANA time zone. Calendar rules are written in
 * local time ("not before 9"), calendar data comes as instants, and daylight
 * saving changes the distance between the two.
 */

/** Calendar date in local time, "YYYY-MM-DD". */
export type LocalDate = string;
/** Time of day in local time, "HH:MM". */
export type LocalTime = string;

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function wallClockParts(instant: Date, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return parts;
}

/** Offset of the zone from UTC at the given instant, in milliseconds. */
function offsetAt(instant: Date, timeZone: string): number {
  const p = wallClockParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

export function isLocalTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The instant at which the zone's clocks show the given date and time. */
export function zonedTimeToUtc(date: LocalDate, time: LocalTime, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`).getTime();
  const first = guess - offsetAt(new Date(guess), timeZone);
  // Near a clock change the first offset can be the one from the other side.
  const second = guess - offsetAt(new Date(first), timeZone);
  return new Date(second);
}

export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const p = wallClockParts(instant, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function localTimeOf(instant: Date, timeZone: string): LocalTime {
  const p = wallClockParts(instant, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

/** Number of days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / (24 * 60 * MINUTE));
}

/** Rounds an instant up to the next multiple of `minutes` on the clock. */
export function ceilToMinutes(instant: Date, minutes: number): Date {
  const step = minutes * MINUTE;
  return new Date(Math.ceil(instant.getTime() / step) * step);
}
