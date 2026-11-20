import { describe, expect, it, vi } from "vitest";
import { CalendarAccessError } from "@/lib/calendar/google";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import type { SlotRequest } from "./search";
import { searchSlots } from "./service";

const NOW = new Date("2026-11-20T10:00:00Z");
const request: SlotRequest = {
  from: "2026-11-23",
  to: "2026-11-24",
  durationMinutes: 45,
  count: 2,
  mode: "online",
};

describe("searchSlots", () => {
  it("loads the whole local days of the period and returns proposals", async () => {
    const loadEvents = vi.fn(async () => []);
    const outcome = await searchSlots(request, loadEvents, DEFAULT_RULES, NOW);

    expect(loadEvents).toHaveBeenCalledWith({
      start: new Date("2026-11-22T23:00:00Z"),
      end: new Date("2026-11-24T23:00:00Z"),
    });
    expect(outcome.ok && outcome.result.proposals.map((p) => `${p.weekday} ${p.start}`)).toEqual([
      "Montag 08:00",
      "Dienstag 08:00",
    ]);
  });

  it.each([
    ["a malformed date", { from: "23.11.2026" }],
    ["an impossible date", { to: "2026-11-31" }],
    ["a malformed time", { earliest: "9 Uhr" }],
    ["a reversed period", { from: "2026-11-25" }],
    ["a zero duration", { durationMinutes: 0 }],
  ])("rejects %s without touching the calendar", async (_name, overrides) => {
    const loadEvents = vi.fn(async () => []);
    const outcome = await searchSlots({ ...request, ...overrides }, loadEvents, DEFAULT_RULES, NOW);
    expect(outcome).toMatchObject({ ok: false, error: "invalidRequest" });
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it("reports a calendar problem instead of guessing", async () => {
    const loadEvents = vi.fn(async () => {
      throw new CalendarAccessError("notConnected");
    });
    expect(await searchSlots(request, loadEvents, DEFAULT_RULES, NOW)).toEqual({
      ok: false,
      error: "calendar",
      problem: "notConnected",
    });
  });
});
