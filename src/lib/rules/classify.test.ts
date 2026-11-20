import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { classifyEvent } from "./classify";
import { DEFAULT_RULES } from "./rules";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    title: "Projektsitzung",
    start: new Date("2026-11-23T09:00:00Z"),
    end: new Date("2026-11-23T10:00:00Z"),
    allDay: false,
    hasVideoLink: false,
    transparent: false,
    cancelled: false,
    myResponse: "accepted",
    optionalForMe: false,
    kind: "default",
    homeOffice: false,
    ...overrides,
  };
}

const classify = (overrides: Partial<CalendarEvent>, processId?: string) =>
  classifyEvent(event(overrides), DEFAULT_RULES, { processId });

describe("classifyEvent", () => {
  it("treats a regular entry as busy", () => {
    expect(classify({})).toEqual({ occupancy: "busy", reason: "regular" });
  });

  it.each(["Evt. Workshop Kunde", "Blocker ABC", "Reserve Offerte", "evt. Lunch"])(
    "treats «%s» as busy even if it looks uncertain",
    (title) => {
      expect(
        classify({ title, transparent: true, myResponse: "tentative", optionalForMe: true }),
      ).toEqual({ occupancy: "busy", reason: "busyKeyword" });
    },
  );

  it("lets a standup be overlapped", () => {
    expect(classify({ title: "Team Standup" })).toEqual({
      occupancy: "movable",
      reason: "movableKeyword",
    });
  });

  it.each(["Homeoffice", "Arbeiten @Home"])("recognises «%s» as home office", (title) => {
    expect(classify({ title, allDay: true, transparent: true })).toEqual({
      occupancy: "homeOffice",
      reason: "homeOffice",
    });
  });

  it("recognises a home-office working location", () => {
    expect(classify({ title: "Zuhause", kind: "workingLocation", homeOffice: true })).toEqual({
      occupancy: "homeOffice",
      reason: "homeOffice",
    });
  });

  it("ignores other working locations", () => {
    expect(classify({ title: "Büro", kind: "workingLocation" })).toEqual({
      occupancy: "free",
      reason: "workingLocation",
    });
  });

  it("mentions tentative, optional entries without blocking", () => {
    expect(classify({ myResponse: "tentative", optionalForMe: true })).toEqual({
      occupancy: "soft",
      reason: "tentativeOptional",
    });
  });

  it("keeps tentative entries busy when attendance is not optional", () => {
    expect(classify({ myResponse: "tentative" }).occupancy).toBe("busy");
  });

  it("keeps unanswered invitations busy", () => {
    expect(classify({ myResponse: "needsAction" }).occupancy).toBe("busy");
  });

  it("does not report own blockers of the same process", () => {
    expect(classify({ title: "Blocker ABC", processId: "p1" }, "p1")).toEqual({
      occupancy: "free",
      reason: "ownBlocker",
    });
  });

  it("keeps blockers of other processes busy", () => {
    expect(classify({ title: "Blocker ABC", processId: "p2" }, "p1").occupancy).toBe("busy");
    expect(classify({ title: "Blocker ABC", processId: "p2" }).occupancy).toBe("busy");
  });

  it("ignores declined and cancelled entries", () => {
    expect(classify({ myResponse: "declined" }).reason).toBe("declined");
    expect(classify({ cancelled: true, title: "Blocker ABC" }).reason).toBe("cancelled");
  });

  it("ignores entries marked as free", () => {
    expect(classify({ transparent: true })).toEqual({ occupancy: "free", reason: "markedFree" });
  });

  it("treats out-of-office as busy", () => {
    expect(classify({ kind: "outOfOffice", transparent: true }).occupancy).toBe("busy");
  });
});
