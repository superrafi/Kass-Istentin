import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { localTimeOf, zonedTimeToUtc } from "@/lib/time/zoned";
import { findSlots, type SlotRequest, type SlotSearchResult } from "./search";

const TZ = DEFAULT_RULES.timeZone;
// Monday 23 to Friday 27 November 2026.
const MON = "2026-11-23";
const TUE = "2026-11-24";
const WED = "2026-11-25";
const NOW = new Date("2026-11-20T10:00:00Z");

let nextId = 0;
function event(
  date: string,
  from: string,
  to: string,
  title: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  nextId += 1;
  return {
    id: `e${nextId}`,
    title,
    start: zonedTimeToUtc(date, from, TZ),
    end: zonedTimeToUtc(date, to, TZ),
    allDay: false,
    hasVideoLink: false,
    transparent: false,
    cancelled: false,
    myResponse: "none",
    optionalForMe: false,
    kind: "default",
    homeOffice: false,
    ...overrides,
  };
}

function allDay(date: string, title: string, overrides: Partial<CalendarEvent> = {}) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return event(date, "00:00", "00:00", title, {
    end: zonedTimeToUtc(next.toISOString().slice(0, 10), "00:00", TZ),
    allDay: true,
    transparent: true,
    ...overrides,
  });
}

function search(overrides: Partial<SlotRequest>, events: CalendarEvent[], now = NOW) {
  return findSlots(
    { from: MON, to: MON, durationMinutes: 45, count: 1, mode: "online", ...overrides },
    events,
    DEFAULT_RULES,
    now,
  );
}

const times = (result: SlotSearchResult) =>
  result.proposals.map((p) => `${p.date} ${localTimeOf(p.start, TZ)}-${localTimeOf(p.end, TZ)}`);
const statuses = (result: SlotSearchResult) =>
  Object.fromEntries(result.days.map((day) => [day.date, day.status]));

describe("findSlots", () => {
  it("proposes the start of the day in an empty calendar", () => {
    expect(times(search({}, []))).toEqual([`${MON} 08:00-08:45`]);
  });

  it("respects «not before 9» and «not over lunch»", () => {
    const result = search({ earliest: "09:00", avoidLunch: true, count: 1 }, [
      event(MON, "09:00", "11:30", "Workshop"),
    ]);
    // 11:30-12:00 is too short, lunch is skipped.
    expect(times(result)).toEqual([`${MON} 13:00-13:45`]);
  });

  it("uses the lunch hour when it is not excluded", () => {
    const result = search({ earliest: "09:00" }, [event(MON, "09:00", "11:30", "Workshop")]);
    expect(times(result)).toEqual([`${MON} 11:30-12:15`]);
  });

  it("starts proposals on the quarter hour", () => {
    const result = search({}, [event(MON, "08:00", "09:10", "Call")]);
    expect(times(result)).toEqual([`${MON} 09:15-10:00`]);
  });

  it("spreads proposals over several days", () => {
    const result = search({ to: "2026-11-27", count: 3 }, []);
    expect(times(result)).toEqual([
      `${MON} 08:00-08:45`,
      `${TUE} 08:00-08:45`,
      `${WED} 08:00-08:45`,
    ]);
    expect(statuses(result)).toMatchObject({
      [MON]: "proposed",
      "2026-11-26": "available",
      "2026-11-27": "available",
    });
  });

  it("takes a second slot per day when the days run out", () => {
    const result = search({ to: TUE, count: 3 }, []);
    expect(times(result)).toEqual([
      `${MON} 08:00-08:45`,
      `${MON} 08:45-09:30`,
      `${TUE} 08:00-08:45`,
    ]);
  });

  it("returns fewer proposals when there is not enough free time", () => {
    const result = search({ count: 3, durationMinutes: 240 }, [
      event(MON, "12:00", "13:00", "Lunch"),
    ]);
    expect(times(result)).toEqual([`${MON} 08:00-12:00`, `${MON} 13:00-17:00`]);
  });

  it("skips weekends", () => {
    const result = search({ from: "2026-11-28", to: "2026-11-30", count: 1 }, []);
    expect(times(result)).toEqual(["2026-11-30 08:00-08:45"]);
    expect(statuses(result)).toMatchObject({
      "2026-11-28": "notAWorkday",
      "2026-11-29": "notAWorkday",
    });
  });

  it("explains a full day with the entries that block it", () => {
    const result = search({ to: TUE }, [
      event(MON, "08:00", "12:30", "Workshop"),
      event(MON, "12:30", "18:00", "Evt. Kundentermin", { transparent: true }),
    ]);
    expect(times(result)).toEqual([`${TUE} 08:00-08:45`]);
    expect(result.days[0]).toMatchObject({ date: MON, status: "full" });
    expect(result.days[0]?.blockedBy.map((b) => [b.title, b.reason])).toEqual([
      ["Workshop", "regular"],
      ["Evt. Kundentermin", "busyKeyword"],
    ]);
  });

  it("treats «Blocker» and «Reserve» entries as busy", () => {
    const result = search({}, [
      event(MON, "08:00", "10:00", "Blocker ABC", { transparent: true }),
      event(MON, "10:00", "11:00", "Reserve Offerte", { myResponse: "tentative" }),
    ]);
    expect(times(result)).toEqual([`${MON} 11:00-11:45`]);
  });

  it("prefers a slot that overlaps nothing over the standup", () => {
    const result = search({}, [event(MON, "08:00", "08:15", "Standup")]);
    expect(times(result)).toEqual([`${MON} 08:15-09:00`]);
    expect(result.proposals[0]?.overlaps).toEqual([]);
  });

  it("overlaps the standup when nothing else is free, and says so", () => {
    const result = search({}, [
      event(MON, "09:00", "09:15", "Standup"),
      event(MON, "08:00", "08:45", "Call"),
      event(MON, "09:30", "18:00", "Workshop"),
    ]);
    expect(times(result)).toEqual([`${MON} 08:45-09:30`]);
    expect(result.proposals[0]?.overlaps.map((o) => [o.title, o.reason])).toEqual([
      ["Standup", "movableKeyword"],
    ]);
  });

  it("mentions a tentative, optional entry instead of blocking", () => {
    const result = search({ earliest: "10:00", latest: "11:00", durationMinutes: 60 }, [
      event(MON, "10:00", "11:00", "Brown Bag", { myResponse: "tentative", optionalForMe: true }),
    ]);
    expect(times(result)).toEqual([`${MON} 10:00-11:00`]);
    expect(result.proposals[0]?.overlaps.map((o) => o.reason)).toEqual(["tentativeOptional"]);
  });

  it("allows calls on a home-office day", () => {
    const result = search({ mode: "online" }, [allDay(MON, "Homeoffice")]);
    expect(times(result)).toEqual([`${MON} 08:00-08:45`]);
  });

  it("allows no on-site meeting on a home-office day", () => {
    const result = search({ mode: "onsite", to: TUE }, [allDay(MON, "Homeoffice")]);
    expect(times(result)).toEqual([`${TUE} 08:00-08:45`]);
    expect(statuses(result)[MON]).toBe("homeOffice");
  });

  it("blocks only the home-office part of a day for on-site meetings", () => {
    const result = search({ mode: "onsite" }, [event(MON, "08:00", "12:00", "@Home")]);
    expect(times(result)).toEqual([`${MON} 12:00-12:45`]);
  });

  it("ignores own blockers of the same process", () => {
    const blocker = event(MON, "08:00", "18:00", "Blocker ABC", { processId: "p1" });
    expect(times(search({ processId: "p1" }, [blocker]))).toEqual([`${MON} 08:00-08:45`]);
    expect(times(search({}, [blocker]))).toEqual([]);
  });

  it("ignores declined entries, cancelled entries and entries marked free", () => {
    const result = search({}, [
      event(MON, "08:00", "12:00", "Abgesagt", { cancelled: true }),
      event(MON, "08:00", "12:00", "Abgelehnt", { myResponse: "declined" }),
      event(MON, "08:00", "12:00", "Erinnerung", { transparent: true }),
      allDay(MON, "Geburtstag"),
    ]);
    expect(times(result)).toEqual([`${MON} 08:00-08:45`]);
  });

  it("blocks the day for an all-day entry that is marked busy", () => {
    const result = search({}, [allDay(MON, "Ferien", { transparent: false })]);
    expect(times(result)).toEqual([]);
    expect(result.days[0]?.blockedBy.map((b) => b.title)).toEqual(["Ferien"]);
  });

  it("names the entries before and after a proposal", () => {
    const result = search({ earliest: "10:00" }, [
      event(MON, "09:00", "09:45", "Kundentermin", { location: "Musterstrasse 1, Bern" }),
      event(MON, "11:30", "12:00", "Call", { hasVideoLink: true }),
      allDay(MON, "Homeoffice"),
    ]);
    const proposal = result.proposals[0];
    expect(times(result)).toEqual([`${MON} 10:00-10:45`]);
    expect(proposal?.before).toMatchObject({
      title: "Kundentermin",
      location: "Musterstrasse 1, Bern",
      online: false,
      gapMinutes: 15,
    });
    expect(proposal?.after).toMatchObject({ title: "Call", online: true, gapMinutes: 45 });
  });

  it("does not propose times in the past", () => {
    const midday = zonedTimeToUtc(MON, "13:05", TZ);
    expect(times(search({}, [], midday))).toEqual([`${MON} 13:15-14:00`]);
    const evening = zonedTimeToUtc(MON, "17:30", TZ);
    expect(statuses(search({}, [], evening))[MON]).toBe("past");
  });

  it("reports a window that is shorter than the meeting", () => {
    const result = search({ earliest: "17:30" }, []);
    expect(statuses(result)[MON]).toBe("windowTooShort");
  });

  it("keeps wall-clock times on the day the clocks change", () => {
    // Monday after the switch to summer time on 29 March 2026.
    const result = search({ from: "2026-03-27", to: "2026-03-30", count: 2, earliest: "09:00" }, [], new Date("2026-03-20T10:00:00Z"));
    expect(times(result)).toEqual(["2026-03-27 09:00-09:45", "2026-03-30 09:00-09:45"]);
    expect(result.proposals.map((p) => p.start.toISOString())).toEqual([
      "2026-03-27T08:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
    ]);
  });

  it("rejects impossible requests", () => {
    expect(() => search({ from: TUE, to: MON }, [])).toThrow(RangeError);
    expect(() => search({ durationMinutes: 0 }, [])).toThrow(RangeError);
    expect(() => search({ count: 0 }, [])).toThrow(RangeError);
    expect(() => search({ to: "2027-11-23" }, [])).toThrow(RangeError);
  });
});
