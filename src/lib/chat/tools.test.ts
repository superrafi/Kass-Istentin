import { describe, expect, it, vi } from "vitest";
import { CalendarAccessError } from "@/lib/calendar/google";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { findFreeSlotsTool } from "./tools";

const now = () => new Date("2026-11-20T10:00:00Z");
const input = {
  from: "2026-11-23",
  to: "2026-11-27",
  duration_minutes: 45,
  count: 3,
  mode: "online" as const,
  earliest: "09:00",
  avoid_lunch: true,
};
const run = async (loadEvents: Parameters<typeof findFreeSlotsTool>[0], overrides = {}) =>
  JSON.parse(String(await findFreeSlotsTool(loadEvents, DEFAULT_RULES, now).run({ ...input, ...overrides })));

describe("find_free_slots tool", () => {
  it("returns proposals computed by the search", async () => {
    const result = await run(vi.fn(async () => []));
    expect(result.proposals.map((p: { weekday: string; start: string }) => `${p.weekday} ${p.start}`)).toEqual([
      "Montag 09:00",
      "Dienstag 09:00",
      "Mittwoch 09:00",
    ]);
  });

  it("tells the model when the request is invalid", async () => {
    expect(await run(vi.fn(async () => []), { from: "nächste Woche" })).toMatchObject({
      error: "invalid_request",
    });
  });

  it("tells the model what to do when the calendar is not connected", async () => {
    const result = await run(
      vi.fn(async () => {
        throw new CalendarAccessError("notConnected");
      }),
    );
    expect(result.error).toBe("calendar");
    expect(result.detail).toContain("neu anmelden");
  });
});
