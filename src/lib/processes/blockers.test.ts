import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { checkSlots } from "@/lib/polls/check";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { zonedTimeToUtc } from "@/lib/time/zoned";
import {
  blockerTitle,
  buildCreateProposal,
  buildDeleteProposal,
  cleanProcessTitle,
  collectProcesses,
  isBlocker,
  spanLabel,
} from "./blockers";

const TZ = DEFAULT_RULES.timeZone;
const MON = "2026-11-23";
const NOW = new Date("2026-11-20T10:00:00Z");

let nextId = 0;
function event(date: string, from: string, to: string, title: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
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

describe("labels and titles", () => {
  it("words a span in local time", () => {
    expect(spanLabel(zonedTimeToUtc(MON, "10:00", TZ), zonedTimeToUtc(MON, "11:30", TZ), TZ)).toBe(
      "Montag, 23.11.2026, 10:00–11:30",
    );
  });

  it("cleans and limits process titles", () => {
    expect(cleanProcessTitle("  Retraite \n 2027 ")).toBe("Retraite 2027");
    expect(cleanProcessTitle("x".repeat(200))).toHaveLength(60);
    expect(blockerTitle("Retraite")).toBe("Blocker Retraite");
  });
});

describe("buildCreateProposal", () => {
  const slots = [
    { date: MON, start: "09:00", end: "10:00" },
    { date: MON, start: "10:00", end: "11:00" },
    { date: MON, start: "14:00", end: "15:00" },
    { date: MON, start: "16:00", end: "17:00" },
  ];
  const calendar = [
    event(MON, "09:00", "09:15", "Standup"),
    event(MON, "10:00", "11:00", "Workshop"),
    event(MON, "16:00", "17:00", "Blocker Retraite", { processId: "p1" }),
  ];
  const findings = checkSlots(slots, calendar, DEFAULT_RULES, NOW, { mode: "online", processId: "p1" });

  it("proposes blockers for free and uncertain slots only", () => {
    const { proposal, skipped } = buildCreateProposal({ id: "p1", title: "Retraite" }, findings, TZ);
    expect(proposal).toMatchObject({
      kind: "createBlockers",
      processId: "p1",
      processTitle: "Retraite",
      eventTitle: "Blocker Retraite",
    });
    expect(proposal?.entries).toEqual([
      {
        start: "2026-11-23T08:00:00.000Z",
        end: "2026-11-23T09:00:00.000Z",
        label: "Montag, 23.11.2026, 09:00–10:00",
        status: "uncertain",
        notes: ["überlagert verschiebbaren Termin: Standup"],
      },
      {
        start: "2026-11-23T13:00:00.000Z",
        end: "2026-11-23T14:00:00.000Z",
        label: "Montag, 23.11.2026, 14:00–15:00",
        status: "free",
        notes: [],
      },
    ]);
    expect(skipped).toEqual([
      { label: "Montag, 23.11.2026, 10:00–11:00", reason: "busy" },
      { label: "Montag, 23.11.2026, 16:00–17:00", reason: "alreadyBlocked" },
    ]);
  });

  it("lists a repeated slot once", () => {
    const twice = checkSlots([slots[2]!, slots[2]!], [], DEFAULT_RULES, NOW, { mode: "online" });
    expect(buildCreateProposal({ id: "p1", title: "Retraite" }, twice, TZ).proposal?.entries).toHaveLength(1);
  });

  it("proposes nothing when no slot is left or the title is empty", () => {
    const busyOnly = findings.filter((finding) => finding.status === "busy");
    expect(buildCreateProposal({ id: "p1", title: "Retraite" }, busyOnly, TZ).proposal).toBeNull();
    expect(buildCreateProposal({ id: "p1", title: "  " }, findings, TZ).proposal).toBeNull();
  });
});

describe("collectProcesses", () => {
  const calendar = [
    event(MON, "14:00", "15:00", "Blocker Retraite", { processId: "p1" }),
    event(MON, "09:00", "10:00", "Blocker Retraite", { processId: "p1" }),
    event("2026-11-24", "09:00", "12:00", "Blocker ABC"),
    event("2026-11-25", "09:00", "12:00", "blocker abc"),
    event(MON, "11:00", "12:00", "Workshop"),
    event(MON, "13:00", "14:00", "Blocker Alt", { processId: "p2", cancelled: true }),
  ];

  it("groups app blockers by process and hand-made blockers by title", () => {
    const processes = collectProcesses(calendar);
    expect(processes.map((p) => [p.ref, p.title, p.manual, p.blockers.length])).toEqual([
      ["p1", "Retraite", false, 2],
      ["title:blocker abc", "ABC", true, 2],
    ]);
    expect(processes[0]?.blockers.map((b) => b.start.toISOString())).toEqual([
      "2026-11-23T08:00:00.000Z",
      "2026-11-23T13:00:00.000Z",
    ]);
  });

  it("recognises blockers", () => {
    expect(isBlocker(calendar[0]!)).toBe(true);
    expect(isBlocker(calendar[2]!)).toBe(true);
    expect(isBlocker(calendar[4]!)).toBe(false);
    expect(isBlocker(calendar[5]!)).toBe(false);
  });
});

describe("buildDeleteProposal", () => {
  const process = collectProcesses([
    event(MON, "09:00", "10:00", "Blocker Retraite", { id: "b1", processId: "p1" }),
    event(MON, "14:00", "15:00", "Blocker Retraite", { id: "b2", processId: "p1" }),
    event("2026-11-24", "09:00", "10:00", "Blocker Retraite", { id: "b3", processId: "p1" }),
  ])[0]!;

  it("keeps the blocker of the confirmed slot and deletes the others", () => {
    const proposal = buildDeleteProposal(process, TZ, { date: MON, start: "14:00", end: "15:00" });
    expect(proposal?.entries.map((entry) => entry.eventId)).toEqual(["b1", "b3"]);
    expect(proposal?.kept.map((entry) => entry.label)).toEqual(["Montag, 23.11.2026, 14:00–15:00"]);
    expect(proposal).toMatchObject({ kind: "deleteBlockers", processTitle: "Retraite" });
  });

  it("deletes all blockers when nothing is kept", () => {
    expect(buildDeleteProposal(process, TZ)?.entries.map((entry) => entry.eventId)).toEqual(["b1", "b2", "b3"]);
  });

  it("proposes nothing when only the confirmed slot is left", () => {
    const single = { ...process, blockers: [process.blockers[1]!] };
    expect(buildDeleteProposal(single, TZ, { date: MON, start: "14:00", end: "15:00" })).toBeNull();
  });
});
