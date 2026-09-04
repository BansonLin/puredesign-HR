import { afterEach, describe, expect, it } from "vitest";
import {
  addDaysTo,
  appTimeZone,
  calendarDaysBetween,
  cutoffInstant,
  dayNumber,
  endOfTaipeiDay,
  formatDate,
  formatTaipei,
  isFriday,
  isPastCutoff,
  taipeiDateOf,
  weekStartMonday,
  workdaysBetween,
} from "@/lib/time";

// PLAN T05 expectations. The suite is run three times (TZ=UTC,
// TZ=Asia/Taipei, TZ=America/Los_Angeles); every value below must hold
// regardless of the process time zone.

const originalTz = process.env.APP_TIMEZONE;
afterEach(() => {
  if (originalTz === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = originalTz;
});

describe("appTimeZone", () => {
  it("defaults to Asia/Taipei when APP_TIMEZONE is unset or blank", () => {
    delete process.env.APP_TIMEZONE;
    expect(appTimeZone()).toBe("Asia/Taipei");
    process.env.APP_TIMEZONE = "  ";
    expect(appTimeZone()).toBe("Asia/Taipei");
  });

  it("is read from APP_TIMEZONE at call time", () => {
    process.env.APP_TIMEZONE = "America/New_York";
    expect(appTimeZone()).toBe("America/New_York");
    // 2026-09-03T16:00Z is 09-04 in Taipei but still 09-03 in New York.
    expect(taipeiDateOf("2026-09-03T16:00:00Z")).toBe("2026-09-03");
    delete process.env.APP_TIMEZONE;
    expect(taipeiDateOf("2026-09-03T16:00:00Z")).toBe("2026-09-04");
  });
});

describe("taipeiDateOf", () => {
  it("maps instants to the Taipei calendar date", () => {
    expect(taipeiDateOf("2026-09-03T15:59:59Z")).toBe("2026-09-03");
    expect(taipeiDateOf("2026-09-03T16:00:00Z")).toBe("2026-09-04");
    expect(taipeiDateOf(new Date("2026-09-03T16:00:00Z"))).toBe("2026-09-04");
  });

  it("accepts offset ISO strings (fixture uses +08:00)", () => {
    expect(taipeiDateOf("2026-09-03T17:01:00+08:00")).toBe("2026-09-03");
    expect(taipeiDateOf("2026-09-04T00:30:00+08:00")).toBe("2026-09-04");
  });

  it("rejects unparsable instants", () => {
    expect(() => taipeiDateOf("not a date")).toThrow(RangeError);
  });

  it("rejects date-only strings (a DateString is not an Instant)", () => {
    expect(() => taipeiDateOf("2026-09-04")).toThrow(RangeError);
    expect(() => isPastCutoff("2026-09-04", "18:00", "2026-09-04")).toThrow(RangeError);
    expect(() => formatTaipei("2026-09-04")).toThrow(RangeError);
  });
});

describe("cutoffInstant / isPastCutoff", () => {
  it("cutoffInstant('2026-09-04','18:00') is 10:00Z", () => {
    expect(cutoffInstant("2026-09-04", "18:00").toISOString()).toBe(
      "2026-09-04T10:00:00.000Z",
    );
    expect(cutoffInstant("2026-09-04", "18:00")).toBeInstanceOf(Date);
  });

  it("isPastCutoff is false at 09:59:59Z and true at 10:00:00Z (>=)", () => {
    expect(isPastCutoff("2026-09-04", "18:00", "2026-09-04T09:59:59Z")).toBe(false);
    expect(isPastCutoff("2026-09-04", "18:00", "2026-09-04T10:00:00Z")).toBe(true);
    expect(
      isPastCutoff("2026-09-04", "18:00", new Date("2026-09-04T10:00:00.000Z")),
    ).toBe(true);
    expect(isPastCutoff("2026-09-04", "18:00", "2026-09-04T09:59:59.999Z")).toBe(false);
  });

  it("matches the §11 fake clocks (9/4 12:00 pending, 9/4 18:30 past)", () => {
    expect(isPastCutoff("2026-09-04", "18:00", "2026-09-04T12:00:00+08:00")).toBe(false);
    expect(isPastCutoff("2026-09-04", "18:00", "2026-09-04T18:30:00+08:00")).toBe(true);
  });

  it("rejects malformed inputs", () => {
    expect(() => cutoffInstant("2026-9-4", "18:00")).toThrow(RangeError);
    expect(() => cutoffInstant("2026-02-30", "18:00")).toThrow(RangeError);
    expect(() => cutoffInstant("2026-09-04", "18")).toThrow(RangeError);
    expect(() => cutoffInstant("2026-09-04", "24:00")).toThrow(RangeError);
    expect(() => cutoffInstant("2026-09-04", "18:60")).toThrow(RangeError);
  });
});

describe("endOfTaipeiDay", () => {
  it("is 23:59:59.999 Taipei = 15:59:59.999Z", () => {
    expect(endOfTaipeiDay("2026-09-03").toISOString()).toBe(
      "2026-09-03T15:59:59.999Z",
    );
  });
});

describe("workdaysBetween", () => {
  it("counts inclusive Mon–Fri workdays", () => {
    expect(workdaysBetween("2026-09-01", "2026-09-04", "mon_fri")).toBe(4);
    expect(workdaysBetween("2026-09-01", "2026-09-07", "mon_fri")).toBe(5);
  });

  it("counts Saturday under mon_sat", () => {
    expect(workdaysBetween("2026-09-01", "2026-09-07", "mon_sat")).toBe(6);
    expect(workdaysBetween("2026-09-05", "2026-09-06", "mon_fri")).toBe(0);
    expect(workdaysBetween("2026-09-05", "2026-09-06", "mon_sat")).toBe(1);
  });

  it("returns 0 when end is before start, 1 for a single workday", () => {
    expect(workdaysBetween("2026-09-04", "2026-09-03", "mon_fri")).toBe(0);
    expect(workdaysBetween("2026-09-04", "2026-09-04", "mon_fri")).toBe(1);
  });
});

describe("weekStartMonday", () => {
  it("returns the Monday of the week", () => {
    expect(weekStartMonday("2026-09-04")).toBe("2026-08-31");
    expect(weekStartMonday("2026-09-07")).toBe("2026-09-07");
    expect(weekStartMonday("2026-09-06")).toBe("2026-08-31"); // Sunday
  });
});

describe("addDaysTo / calendarDaysBetween", () => {
  it("adds calendar days across month boundaries", () => {
    expect(addDaysTo("2026-09-01", 30)).toBe("2026-10-01");
    expect(addDaysTo("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("differences are signed calendar days", () => {
    expect(calendarDaysBetween("2026-09-01", "2026-09-03")).toBe(2);
    expect(calendarDaysBetween("2026-09-03", "2026-09-01")).toBe(-2);
  });
});

describe("dayNumber", () => {
  it("is today - start_date + 1", () => {
    expect(dayNumber("2026-09-01", "2026-09-03")).toBe(3);
    expect(dayNumber("2026-09-01", "2026-09-01")).toBe(1);
  });

  it("is 0 when start_date is in the future and null when unset (A09)", () => {
    expect(dayNumber("2026-09-10", "2026-09-04")).toBe(0);
    expect(dayNumber(null, "2026-09-04")).toBeNull();
  });
});

describe("isFriday", () => {
  it("is true on 2026-09-04 and false on other days", () => {
    expect(isFriday("2026-09-04")).toBe(true);
    expect(isFriday("2026-09-03")).toBe(false);
    expect(isFriday("2026-09-07")).toBe(false);
  });
});

describe("formatTaipei / formatDate", () => {
  it("formats instants in Taipei time", () => {
    expect(formatTaipei("2026-09-04T09:10:00Z")).toBe("2026/09/04 17:10");
    expect(formatTaipei("2026-09-03T16:00:00Z", "M/d")).toBe("9/4");
    expect(formatTaipei("2026-09-03T16:00:00Z", "HH:mm")).toBe("00:00");
  });

  it("formats date strings without a time-zone shift", () => {
    expect(formatDate("2026-09-11")).toBe("2026/09/11");
    expect(formatDate("2026-09-11", "M/d")).toBe("9/11");
  });
});
