import { describe, expect, it, vi } from "vitest";
import { CalendarAccessError } from "@/lib/calendar/google";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { Proposal } from "@/lib/proposals/types";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import type { EventLoader } from "@/lib/slots/service";
import { zonedTimeToUtc } from "@/lib/time/zoned";
import { assistantTools } from "./tools";

const TZ = DEFAULT_RULES.timeZone;
const MON = "2026-11-23";

function event(from: string, to: string, title: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `id-${from}-${title}`,
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

function setup(events: CalendarEvent[] | Error = []) {
  const shown: Proposal[] = [];
  const loadEvents = vi.fn<EventLoader>(async () => {
    if (events instanceof Error) throw events;
    return events;
  });
  const tools = assistantTools({
    loadEvents,
    rules: DEFAULT_RULES,
    now: () => new Date("2026-11-20T10:00:00Z"),
    showProposal: (proposal) => shown.push(proposal),
    newId: () => "new-process",
  });
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name)!;
    return JSON.parse(String(await (tool.run as (input: unknown) => Promise<string>)(input)));
  };
  return { run, shown, loadEvents, names: tools.map((tool) => tool.name) };
}

const pollSlots = [
  { date: MON, start: "09:00", end: "10:00" },
  { date: MON, start: "14:00", end: "15:00" },
];

describe("assistant tools", () => {
  it("offers no tool that writes directly", () => {
    expect(setup().names).toEqual([
      "find_free_slots",
      "check_poll_slots",
      "propose_blockers",
      "list_processes",
      "propose_blocker_cleanup",
    ]);
  });

  it("find_free_slots returns proposals computed by the search", async () => {
    const result = await setup().run("find_free_slots", {
      from: MON,
      to: "2026-11-27",
      duration_minutes: 45,
      count: 3,
      mode: "online",
      earliest: "09:00",
      avoid_lunch: true,
    });
    expect(result.proposals.map((p: { weekday: string; start: string }) => `${p.weekday} ${p.start}`)).toEqual([
      "Montag 09:00",
      "Dienstag 09:00",
      "Mittwoch 09:00",
    ]);
  });

  it("find_free_slots tells the model when the request is invalid", async () => {
    const result = await setup().run("find_free_slots", {
      from: "nächste Woche",
      to: MON,
      duration_minutes: 45,
      count: 1,
      mode: "online",
    });
    expect(result).toMatchObject({ error: "invalid_request" });
  });

  it("check_poll_slots gives a finding with reasons per slot", async () => {
    const { run, shown } = setup([event("09:30", "10:30", "Workshop", { location: "Musterstrasse 1, Bern" })]);
    const result = await run("check_poll_slots", { slots: pollSlots, mode: "online" });
    expect(result.findings).toEqual([
      {
        slot: "Montag, 23.11.2026, 09:00–10:00",
        status: "busy",
        reasons: [
          {
            code: "conflict",
            entry: "Workshop",
            when: "Montag, 23.11.2026, 09:30–10:30",
            location: "Musterstrasse 1, Bern",
          },
        ],
      },
      { slot: "Montag, 23.11.2026, 14:00–15:00", status: "free", reasons: [] },
    ]);
    expect(shown).toEqual([]);
  });

  it("propose_blockers shows a proposal for the free slots and writes nothing", async () => {
    const { run, shown } = setup([event("09:30", "10:30", "Workshop")]);
    const result = await run("propose_blockers", { title: "Retraite", slots: pollSlots, mode: "online" });

    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      kind: "createBlockers",
      processId: "new-process",
      eventTitle: "Blocker Retraite",
      entries: [{ label: "Montag, 23.11.2026, 14:00–15:00", status: "free" }],
    });
    expect(result.skipped).toEqual([{ label: "Montag, 23.11.2026, 09:00–10:00", reason: "busy" }]);
    expect(result.note).toContain("noch nichts im Kalender geändert");
  });

  it("propose_blockers adds to an existing process without duplicating its blockers", async () => {
    const { run, shown } = setup([event("14:00", "15:00", "Blocker Retraite", { processId: "p1" })]);
    const result = await run("propose_blockers", {
      title: "Retraite",
      slots: pollSlots,
      mode: "online",
      process_ref: "p1",
    });
    expect(shown[0]).toMatchObject({ processId: "p1", entries: [{ label: "Montag, 23.11.2026, 09:00–10:00" }] });
    expect(result.skipped).toEqual([{ label: "Montag, 23.11.2026, 14:00–15:00", reason: "alreadyBlocked" }]);
  });

  it("propose_blockers shows nothing when every slot is busy", async () => {
    const { run, shown } = setup([event("08:00", "18:00", "Workshop")]);
    const result = await run("propose_blockers", { title: "Retraite", slots: pollSlots, mode: "online" });
    expect(shown).toEqual([]);
    expect(result.proposed).toEqual([]);
  });

  it("list_processes names processes with their blockers", async () => {
    const { run } = setup([
      event("14:00", "15:00", "Blocker Retraite", { processId: "p1" }),
      event("16:00", "17:00", "Blocker ABC"),
      event("09:00", "10:00", "Workshop"),
    ]);
    expect((await run("list_processes", {})).processes).toEqual([
      { ref: "p1", title: "Retraite", blockers: ["Montag, 23.11.2026, 14:00–15:00"] },
      { ref: "title:blocker abc", title: "ABC", manual: true, blockers: ["Montag, 23.11.2026, 16:00–17:00"] },
    ]);
  });

  it("propose_blocker_cleanup keeps the confirmed slot and shows the rest for deletion", async () => {
    const { run, shown } = setup([
      event("09:00", "10:00", "Blocker Retraite", { processId: "p1", id: "b1" }),
      event("14:00", "15:00", "Blocker Retraite", { processId: "p1", id: "b2" }),
    ]);
    const result = await run("propose_blocker_cleanup", { process_ref: "p1", keep: pollSlots[1] });

    expect(shown[0]).toMatchObject({ kind: "deleteBlockers", entries: [{ eventId: "b1" }] });
    expect(result).toMatchObject({
      to_delete: ["Montag, 23.11.2026, 09:00–10:00"],
      kept: ["Montag, 23.11.2026, 14:00–15:00"],
    });
    expect(result.warning).toBeUndefined();
  });

  it("propose_blocker_cleanup warns when the confirmed slot has no blocker", async () => {
    const { run } = setup([event("09:00", "10:00", "Blocker Retraite", { processId: "p1" })]);
    const result = await run("propose_blocker_cleanup", {
      process_ref: "p1",
      keep: { date: MON, start: "16:00", end: "17:00" },
    });
    expect(result.warning).toContain("keinen Blocker");
  });

  it("propose_blocker_cleanup rejects an unknown process", async () => {
    const { run, shown } = setup([]);
    expect(await run("propose_blocker_cleanup", { process_ref: "nope" })).toMatchObject({ error: "unknown_process" });
    expect(shown).toEqual([]);
  });

  it.each(["check_poll_slots", "propose_blockers"])("%s rejects malformed slots", async (name) => {
    const { run, loadEvents } = setup();
    const result = await run(name, { title: "x", mode: "online", slots: [{ date: MON, start: "15:00", end: "14:00" }] });
    expect(result).toMatchObject({ error: "invalid_request" });
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it.each([
    ["check_poll_slots", { slots: pollSlots, mode: "online" }],
    ["propose_blockers", { title: "Retraite", slots: pollSlots, mode: "online" }],
    ["list_processes", {}],
    ["propose_blocker_cleanup", { process_ref: "p1" }],
  ])("%s tells the model what to do when the calendar is not connected", async (name, input) => {
    const { run, shown } = setup(new CalendarAccessError("notConnected"));
    const result = await run(name, input);
    expect(result.error).toBe("calendar");
    expect(result.detail).toContain("neu anmelden");
    expect(shown).toEqual([]);
  });
});
