import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { zonedTimeToUtc } from "@/lib/time/zoned";
import { checkSlots, type CheckContext, pollPeriod, type PollSlot } from "./check";

const TZ = DEFAULT_RULES.timeZone;
const MON = "2026-11-23";
const NOW = new Date("2026-11-20T10:00:00Z");
const slot = (start: string, end: string, date = MON): PollSlot => ({ date, start, end });

let nextId = 0;
function event(from: string, to: string, title: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  nextId += 1;
  return {
    id: `e${nextId}`,
    title,
    start: zonedTimeToUtc(MON, from, TZ),
    end: zonedTimeToUtc(MON, to, TZ),
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

function check(slots: PollSlot[], events: CalendarEvent[], context: Partial<CheckContext> = {}, now = NOW) {
  return checkSlots(slots, events, DEFAULT_RULES, now, { mode: "online", ...context });
}
const summary = (findings: ReturnType<typeof check>) =>
  findings.map((finding) => [finding.status, ...finding.reasons.map((reason) => reason.code)]);

describe("checkSlots", () => {
  it("reports a slot in an empty calendar as free", () => {
    expect(summary(check([slot("10:00", "11:00")], []))).toEqual([["free"]]);
  });

  it("checks every slot of a poll on its own", () => {
    const findings = check(
      [slot("09:00", "10:00"), slot("10:00", "11:00"), slot("14:00", "15:00")],
      [event("09:30", "10:30", "Workshop")],
    );
    expect(summary(findings)).toEqual([["busy", "conflict"], ["busy", "conflict"], ["free"]]);
    expect(findings[0]?.reasons[0]?.event?.title).toBe("Workshop");
  });

  it("treats «Evt.» entries as busy", () => {
    const findings = check([slot("10:00", "11:00")], [event("10:00", "11:00", "Evt. Kundentermin", { transparent: true })]);
    expect(summary(findings)).toEqual([["busy", "conflict"]]);
  });

  it("is uncertain when the slot overlaps a standup or a tentative, optional entry", () => {
    const findings = check(
      [slot("09:00", "10:00"), slot("14:00", "15:00")],
      [
        event("09:00", "09:15", "Standup"),
        event("14:00", "15:00", "Brown Bag", { myResponse: "tentative", optionalForMe: true }),
      ],
    );
    expect(summary(findings)).toEqual([["uncertain", "movable"], ["uncertain", "tentative"]]);
  });

  it("is uncertain when an entry at another place lies shortly before or after", () => {
    const findings = check(
      [slot("10:00", "11:00"), slot("13:00", "14:00")],
      [
        event("08:30", "09:30", "Kundentermin", { location: "Musterstrasse 1, Bern" }),
        event("11:30", "12:00", "Besichtigung", { location: "Beispielweg 2, Basel" }),
      ],
    );
    expect(summary(findings)).toEqual([["uncertain", "placeBefore", "placeAfter"], ["free"]]);
    expect(findings[0]?.reasons.map((reason) => reason.event?.title)).toEqual(["Kundentermin", "Besichtigung"]);
  });

  it("ignores online entries and distant entries around the slot", () => {
    const findings = check(
      [slot("10:00", "11:00")],
      [
        event("09:00", "10:00", "Call", { hasVideoLink: true }),
        event("12:00", "13:00", "Lunch", { location: "Restaurant Beispiel" }),
      ],
    );
    expect(summary(findings)).toEqual([["free"]]);
  });

  it("allows calls but no on-site meetings on a home-office day", () => {
    const homeOffice = event("00:00", "23:59", "Homeoffice", { allDay: true, transparent: true });
    expect(summary(check([slot("10:00", "11:00")], [homeOffice]))).toEqual([["free"]]);
    expect(summary(check([slot("10:00", "11:00")], [homeOffice], { mode: "onsite" }))).toEqual([
      ["busy", "homeOffice"],
    ]);
  });

  it("flags slots outside the usual day and on weekends as uncertain", () => {
    const findings = check([slot("18:00", "19:30"), slot("10:00", "11:00", "2026-11-28")], []);
    expect(summary(findings)).toEqual([["uncertain", "outsideHours"], ["uncertain", "notAWorkday"]]);
  });

  it("reports past slots as busy", () => {
    const later = zonedTimeToUtc(MON, "12:00", TZ);
    expect(summary(check([slot("10:00", "11:00")], [], {}, later))).toEqual([["busy", "past"]]);
  });

  it("does not report own blockers of the same process and notices existing ones", () => {
    const blocker = event("10:00", "11:00", "Blocker Retraite", { processId: "p1" });
    const mine = check([slot("10:00", "11:00"), slot("10:30", "11:30")], [blocker], { processId: "p1" });
    expect(summary(mine)).toEqual([["free"], ["free"]]);
    expect(mine.map((finding) => finding.alreadyBlocked)).toEqual([true, false]);

    const other = check([slot("10:00", "11:00")], [blocker], { processId: "p2" });
    expect(summary(other)).toEqual([["busy", "conflict"]]);
    expect(other[0]?.alreadyBlocked).toBe(false);
  });

  it.each([
    ["no slots", []],
    ["a malformed date", [{ date: "23.11.", start: "10:00", end: "11:00" }]],
    ["a malformed time", [{ date: MON, start: "10", end: "11:00" }]],
    ["an end before the start", [slot("11:00", "10:00")]],
    ["too many slots", Array.from({ length: 31 }, () => slot("10:00", "11:00"))],
  ])("rejects %s", (_name, slots) => {
    expect(() => check(slots, [])).toThrow(RangeError);
  });
});

describe("pollPeriod", () => {
  it("covers all days of the poll", () => {
    const period = pollPeriod([slot("10:00", "11:00", "2026-11-25"), slot("10:00", "11:00", MON)], TZ);
    expect(period.start).toEqual(zonedTimeToUtc(MON, "00:00", TZ));
    expect(period.end).toEqual(zonedTimeToUtc("2026-11-25", "23:59", TZ));
  });
});
