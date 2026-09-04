/**
 * Time helpers for the application time zone (CLAUDE.md §0/§3/§4).
 *
 * Every function is pure: it takes `now` (or an explicit date/instant) as an
 * argument and never reads the wall clock. The time zone name comes from
 * `APP_TIMEZONE` (default `Asia/Taipei`, read at call time so tests can
 * override it). Calendar dates are always exchanged as `YYYY-MM-DD` strings;
 * instants as `Date` (or an ISO 8601 date-time string that `Date` can parse;
 * date-only strings are rejected, see `Instant`).
 *
 * This module must not import `lib/db` (PLAN T05).
 */
import { TZDate } from "@date-fns/tz";
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
  getDay,
  startOfWeek,
} from "date-fns";

/** Calendar date in the app time zone, `YYYY-MM-DD`. */
export type DateString = string;

/**
 * A point in time: `Date`, or an ISO 8601 date-time string with an explicit
 * offset — ending in `Z` or `±HH:mm` (e.g. `2026-09-04T10:00:00Z`,
 * `2026-09-04T18:00:00+08:00`, PostgREST's `…+00:00`). Anything else is
 * rejected with `RangeError`: a date-only `YYYY-MM-DD` string is a
 * `DateString`, not an instant (`new Date('YYYY-MM-DD')` would silently mean
 * UTC midnight), and a date-time without an offset
 * (`2026-09-04T18:00:00`) would be read in the process time zone.
 */
export type Instant = Date | string;

/** Work-week scheme for `workdaysBetween` (settings key `workweek`, PLAN 4.8). */
export type Workweek = "mon_fri" | "mon_sat";

export const DEFAULT_TIMEZONE = "Asia/Taipei";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
/** ISO 8601 date-time with a mandatory `Z` or `±HH:mm` offset. */
const INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_FORMAT = "yyyy-MM-dd";

/** Time zone name from `APP_TIMEZONE`, default `Asia/Taipei`. */
export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE;
  return tz && tz.trim() !== "" ? tz.trim() : DEFAULT_TIMEZONE;
}

/**
 * `value` as a `Date`. Strings must be ISO 8601 date-times with an explicit
 * `Z` / `±HH:mm` offset (see `Instant`); a date-only string or a naive
 * date-time throws `RangeError`. Exported so other modules (`lib/rules`)
 * apply exactly this gate instead of calling `new Date(string)` themselves.
 */
export function toInstant(value: Instant): Date {
  if (typeof value === "string") {
    if (DATE_RE.test(value)) {
      throw new RangeError(
        `Date-only string is not an instant (pass a DateString function or an ISO date-time): ${value}`,
      );
    }
    if (!INSTANT_RE.test(value)) {
      throw new RangeError(
        `Invalid instant (expected an ISO 8601 date-time ending in Z or ±HH:mm): ${value}`,
      );
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant: ${String(value)}`);
  }
  return date;
}

function parseDateString(value: DateString): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_RE.exec(value);
  if (!match) {
    throw new RangeError(`Invalid date string (expected YYYY-MM-DD): ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through TZDate to reject e.g. 2026-02-30.
  const probe = new TZDate(year, month - 1, day, appTimeZone());
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

/**
 * `true` when `value` is a real calendar date written as `YYYY-MM-DD`
 * (`2026-02-30`, `2026-9-4` and `2026-08-31T00:00:00Z` are all `false`).
 * Form validation uses this so date checks stay in lib/time (PLAN K4).
 */
export function isDateString(value: string): boolean {
  try {
    parseDateString(value);
    return true;
  } catch {
    return false;
  }
}

function parseTimeString(value: string): { hours: number; minutes: number } {
  const match = TIME_RE.exec(value);
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match ? Number(match[2]) : NaN;
  if (!match || hours > 23 || minutes > 59) {
    throw new RangeError(`Invalid time string (expected HH:mm): ${value}`);
  }
  return { hours, minutes };
}

/** Midnight of `date` in the app time zone, as a tz-aware `TZDate`. */
function zonedDate(date: DateString): TZDate {
  const { year, month, day } = parseDateString(date);
  return new TZDate(year, month - 1, day, appTimeZone());
}

/** `instant` viewed in the app time zone, as a tz-aware `TZDate`. */
function zonedInstant(instant: Instant): TZDate {
  return new TZDate(toInstant(instant), appTimeZone());
}

function toDateString(zoned: TZDate): DateString {
  return format(zoned, DATE_FORMAT);
}

/** Calendar date (`YYYY-MM-DD`) of `instant` in the app time zone. */
export function taipeiDateOf(instant: Instant): DateString {
  return toDateString(zonedInstant(instant));
}

/**
 * The instant at which `cutoff` (`HH:mm`, app time zone) occurs on `date`.
 * `cutoffInstant('2026-09-04', '18:00')` → `2026-09-04T10:00:00.000Z`.
 */
export function cutoffInstant(date: DateString, cutoff: string): Date {
  const { year, month, day } = parseDateString(date);
  const { hours, minutes } = parseTimeString(cutoff);
  return new Date(
    new TZDate(year, month - 1, day, hours, minutes, 0, 0, appTimeZone()).getTime(),
  );
}

/** `true` once `now` is at or after (`>=`) the cutoff of `date` (§7 R3). */
export function isPastCutoff(
  date: DateString,
  cutoff: string,
  now: Instant,
): boolean {
  return toInstant(now).getTime() >= cutoffInstant(date, cutoff).getTime();
}

/** Last millisecond of `date` in the app time zone (`23:59:59.999`). */
export function endOfTaipeiDay(date: DateString): Date {
  const { year, month, day } = parseDateString(date);
  return new Date(
    new TZDate(year, month - 1, day, 23, 59, 59, 999, appTimeZone()).getTime(),
  );
}

/**
 * Number of workdays in the inclusive range `[start, end]`.
 * `mon_fri` counts Monday–Friday; `mon_sat` also counts Saturday.
 * Returns 0 when `end` is before `start`.
 */
export function workdaysBetween(
  start: DateString,
  end: DateString,
  workweek: Workweek,
): number {
  const first = zonedDate(start);
  const last = zonedDate(end);
  if (last.getTime() < first.getTime()) return 0;
  const maxDay = workweek === "mon_sat" ? 6 : 5; // getDay: 0=Sun … 6=Sat
  return eachDayOfInterval({ start: first, end: last }).filter((day) => {
    const dow = getDay(day);
    return dow >= 1 && dow <= maxDay;
  }).length;
}

/** Monday (`YYYY-MM-DD`) of the week containing `date`. */
export function weekStartMonday(date: DateString): DateString {
  return toDateString(startOfWeek(zonedDate(date), { weekStartsOn: 1 }));
}

/** Add `days` calendar days to `date` (negative allowed). */
export function addDaysTo(date: DateString, days: number): DateString {
  return toDateString(addDays(zonedDate(date), days));
}

/** Calendar days from `from` to `to` (`to - from`; negative when `to` is earlier). */
export function calendarDaysBetween(from: DateString, to: DateString): number {
  return differenceInCalendarDays(zonedDate(to), zonedDate(from));
}

/**
 * Day number of the onboarding (PLAN A09): `today - start_date + 1` in
 * calendar days. `0` when `start_date` is in the future ("尚未到職"),
 * `null` when `start_date` is not set.
 */
export function dayNumber(
  startDate: DateString | null,
  today: DateString,
): number | null {
  if (startDate === null) return null;
  const diff = calendarDaysBetween(startDate, today);
  return diff < 0 ? 0 : diff + 1;
}

/** `true` when `date` falls on a Friday (weekly-feedback reminder, §8). */
export function isFriday(date: DateString): boolean {
  return getDay(zonedDate(date)) === 5;
}

/** Default display pattern for instants (date-fns tokens). */
export const DISPLAY_DATETIME_FORMAT = "yyyy/MM/dd HH:mm";

/**
 * Format `instant` in the app time zone for display.
 * Default pattern `yyyy/MM/dd HH:mm`; pass e.g. `'M/d'` for the one-line
 * summary date (PLAN A13) or `'HH:mm'` for a time only.
 */
export function formatTaipei(
  instant: Instant,
  pattern: string = DISPLAY_DATETIME_FORMAT,
): string {
  return format(zonedInstant(instant), pattern);
}

/**
 * Format a `YYYY-MM-DD` date for display (no time-zone shift involved).
 * Default pattern `yyyy/MM/dd`; e.g. `formatDate('2026-09-11', 'M/d')` → `9/11`.
 */
export function formatDate(
  date: DateString,
  pattern: string = "yyyy/MM/dd",
): string {
  return format(zonedDate(date), pattern);
}
