import { describe, expect, it } from "vitest";
import {
  addDays,
  ceilToMinutes,
  daysBetween,
  isLocalDate,
  isLocalTime,
  isoWeekday,
  localDateOf,
  localTimeOf,
  zonedTimeToUtc,
} from "./zoned";

const ZURICH = "Europe/Zurich";

describe("zonedTimeToUtc", () => {
  it("uses the winter offset", () => {
    expect(zonedTimeToUtc("2026-01-15", "09:00", ZURICH).toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
  });

  it("uses the summer offset", () => {
    expect(zonedTimeToUtc("2026-07-15", "09:00", ZURICH).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
  });

  it("is right on the day clocks go forward", () => {
    // 29 March 2026: 02:00 becomes 03:00.
    expect(zonedTimeToUtc("2026-03-29", "00:00", ZURICH).toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-03-29", "09:00", ZURICH).toISOString()).toBe(
      "2026-03-29T07:00:00.000Z",
    );
  });

  it("is right on the day clocks go back", () => {
    // 25 October 2026: 03:00 becomes 02:00.
    expect(zonedTimeToUtc("2026-10-25", "00:00", ZURICH).toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-10-25", "09:00", ZURICH).toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
  });
});

describe("local date and time", () => {
  it("reads the local date across midnight", () => {
    const lateEvening = new Date("2026-07-15T22:30:00Z");
    expect(localDateOf(lateEvening, ZURICH)).toBe("2026-07-16");
    expect(localTimeOf(lateEvening, ZURICH)).toBe("00:30");
  });

  it("round-trips with zonedTimeToUtc", () => {
    const instant = zonedTimeToUtc("2026-11-23", "13:45", ZURICH);
    expect(localDateOf(instant, ZURICH)).toBe("2026-11-23");
    expect(localTimeOf(instant, ZURICH)).toBe("13:45");
  });
});

describe("date arithmetic", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday", () => {
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(isoWeekday("2026-11-29")).toBe(7);
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-11-23", "2026-11-27")).toBe(4);
    expect(daysBetween("2026-11-27", "2026-11-23")).toBe(-4);
  });

  it("rounds up to the quarter hour", () => {
    expect(ceilToMinutes(new Date("2026-11-23T08:01:00Z"), 15).toISOString()).toBe(
      "2026-11-23T08:15:00.000Z",
    );
    expect(ceilToMinutes(new Date("2026-11-23T08:15:00Z"), 15).toISOString()).toBe(
      "2026-11-23T08:15:00.000Z",
    );
  });
});

describe("validation", () => {
  it("accepts real dates only", () => {
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("28.02.2026")).toBe(false);
  });

  it("accepts 24-hour times only", () => {
    expect(isLocalTime("09:00")).toBe(true);
    expect(isLocalTime("24:00")).toBe(false);
    expect(isLocalTime("9:00")).toBe(false);
  });
});
