import { describe, expect, it } from "vitest";
import { presentSlotResult } from "./present";
import type { EventNote, SlotSearchResult } from "./search";

const TZ = "Europe/Zurich";
const note = (overrides: Partial<EventNote> = {}): EventNote => ({
  title: "Kundentermin",
  start: new Date("2026-11-23T08:00:00Z"),
  end: new Date("2026-11-23T08:45:00Z"),
  allDay: false,
  online: false,
  reason: "regular",
  ...overrides,
});

const result: SlotSearchResult = {
  proposals: [
    {
      date: "2026-11-23",
      start: new Date("2026-11-23T09:00:00Z"),
      end: new Date("2026-11-23T09:45:00Z"),
      before: { ...note({ location: "Musterstrasse 1, Bern" }), gapMinutes: 15 },
      overlaps: [note({ title: "Standup", reason: "movableKeyword", online: true })],
    },
  ],
  days: [
    { date: "2026-11-23", status: "proposed", blockedBy: [] },
    {
      date: "2026-11-24",
      status: "full",
      blockedBy: [
        note({
          title: "Ferien",
          allDay: true,
          start: new Date("2026-11-23T23:00:00Z"),
          end: new Date("2026-11-24T23:00:00Z"),
        }),
      ],
    },
  ],
};

describe("presentSlotResult", () => {
  it("gives local times, weekdays and surroundings", () => {
    expect(presentSlotResult(result, TZ)).toEqual({
      time_zone: TZ,
      proposals: [
        {
          date: "2026-11-23",
          weekday: "Montag",
          start: "10:00",
          end: "10:45",
          before: {
            title: "Kundentermin",
            start: "09:00",
            end: "09:45",
            location: "Musterstrasse 1, Bern",
            reason: "regular",
            gap_minutes: 15,
          },
          overlaps: [
            { title: "Standup", start: "09:00", end: "09:45", online: true, reason: "movableKeyword" },
          ],
        },
      ],
      days: [
        { date: "2026-11-23", weekday: "Montag", status: "proposed" },
        {
          date: "2026-11-24",
          weekday: "Dienstag",
          status: "full",
          blocked_by: [{ title: "Ferien", all_day: true, reason: "regular" }],
        },
      ],
    });
  });

  it("adds dates to entries that span midnight", () => {
    const overnight = note({
      title: "Nachtzug",
      start: new Date("2026-11-22T21:00:00Z"),
      end: new Date("2026-11-23T07:30:00Z"),
    });
    const presented = presentSlotResult(
      { proposals: [], days: [{ date: "2026-11-23", status: "full", blockedBy: [overnight] }] },
      TZ,
    );
    expect(presented.days[0]?.blocked_by?.[0]).toMatchObject({
      start: "22:00",
      end: "08:30",
      start_date: "2026-11-22",
      end_date: "2026-11-23",
    });
  });

  it("clips long titles", () => {
    const long = note({ title: "x".repeat(300) });
    const presented = presentSlotResult(
      { proposals: [], days: [{ date: "2026-11-23", status: "full", blockedBy: [long] }] },
      TZ,
    );
    expect(presented.days[0]?.blocked_by?.[0]?.title).toHaveLength(120);
  });
});
