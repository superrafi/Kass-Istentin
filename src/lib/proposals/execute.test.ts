import { describe, expect, it, vi } from "vitest";
import { CalendarAccessError } from "@/lib/calendar/google";
import type { CalendarEvent } from "@/lib/calendar/types";
import { type CalendarWriter, executeProposal } from "./execute";
import type { CreateBlockersProposal, DeleteBlockersProposal } from "./types";

function event(id: string, start: string, end: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    title: "Blocker Retraite",
    start: new Date(start),
    end: new Date(end),
    allDay: false,
    hasVideoLink: false,
    transparent: false,
    cancelled: false,
    myResponse: "none",
    optionalForMe: false,
    kind: "default",
    homeOffice: false,
    processId: "p1",
    ...overrides,
  };
}

function writer(existing: CalendarEvent[] = []): CalendarWriter & { [K in keyof CalendarWriter]: ReturnType<typeof vi.fn> } {
  return {
    list: vi.fn(async () => existing),
    insert: vi.fn(async () => "new-id"),
    get: vi.fn(async (id: string) => existing.find((e) => e.id === id) ?? null),
    remove: vi.fn(async () => undefined),
  };
}

const A = { start: "2026-11-23T08:00:00.000Z", end: "2026-11-23T09:00:00.000Z", label: "A" };
const B = { start: "2026-11-24T13:00:00.000Z", end: "2026-11-24T14:00:00.000Z", label: "B" };
const create: CreateBlockersProposal = {
  kind: "createBlockers",
  processId: "p1",
  processTitle: "Retraite",
  eventTitle: "Blocker Retraite",
  entries: [
    { ...A, status: "free", notes: [] },
    { ...B, status: "uncertain", notes: [] },
  ],
};
const remove: DeleteBlockersProposal = {
  kind: "deleteBlockers",
  processTitle: "Retraite",
  entries: [
    { ...A, eventId: "b1", title: "Blocker Retraite" },
    { ...B, eventId: "b2", title: "Blocker Retraite" },
  ],
  kept: [],
};

describe("executeProposal: create", () => {
  it("creates exactly the listed blockers, linked to the process", async () => {
    const calendar = writer();
    const result = await executeProposal(create, calendar);

    expect(result).toEqual({
      kind: "createBlockers",
      entries: [
        { label: "A", outcome: "created" },
        { label: "B", outcome: "created" },
      ],
    });
    expect(calendar.list).toHaveBeenCalledWith({ start: new Date(A.start), end: new Date(B.end) });
    expect(calendar.insert.mock.calls.map(([blocker]) => blocker)).toMatchObject([
      { title: "Blocker Retraite", start: new Date(A.start), end: new Date(A.end), processId: "p1" },
      { title: "Blocker Retraite", start: new Date(B.start), end: new Date(B.end), processId: "p1" },
    ]);
    expect(calendar.remove).not.toHaveBeenCalled();
  });

  it("creates no duplicate when the proposal is confirmed twice", async () => {
    const calendar = writer([event("b1", A.start, A.end)]);
    const result = await executeProposal(create, calendar);
    expect(result.entries.map((entry) => entry.outcome)).toEqual(["exists", "created"]);
    expect(calendar.insert).toHaveBeenCalledTimes(1);
  });

  it("does not mistake another process's blocker for a duplicate", async () => {
    const calendar = writer([event("x", A.start, A.end, { processId: "p2" })]);
    expect((await executeProposal(create, calendar)).entries[0]?.outcome).toBe("created");
  });

  it("reports a single failed entry and carries on", async () => {
    const calendar = writer();
    calendar.insert.mockRejectedValueOnce(new CalendarAccessError("unavailable"));
    expect((await executeProposal(create, calendar)).entries.map((entry) => entry.outcome)).toEqual([
      "failed",
      "created",
    ]);
  });

  it("stops when write access is missing", async () => {
    const calendar = writer();
    calendar.insert.mockRejectedValue(new CalendarAccessError("notConnected"));
    await expect(executeProposal(create, calendar)).rejects.toMatchObject({ problem: "notConnected" });
  });
});

describe("executeProposal: delete", () => {
  it("deletes the listed blockers", async () => {
    const calendar = writer([event("b1", A.start, A.end), event("b2", B.start, B.end)]);
    const result = await executeProposal(remove, calendar);
    expect(result.entries.map((entry) => entry.outcome)).toEqual(["deleted", "deleted"]);
    expect(calendar.remove.mock.calls.map(([id]) => id)).toEqual(["b1", "b2"]);
    expect(calendar.insert).not.toHaveBeenCalled();
  });

  it("deletes a hand-made blocker that is named as one", async () => {
    const calendar = writer([event("b1", A.start, A.end, { processId: undefined, title: "Blocker ABC" })]);
    expect((await executeProposal(remove, calendar)).entries[0]?.outcome).toBe("deleted");
  });

  it("treats a missing entry as already gone", async () => {
    const calendar = writer([event("b2", B.start, B.end)]);
    const result = await executeProposal(remove, calendar);
    expect(result.entries.map((entry) => entry.outcome)).toEqual(["gone", "deleted"]);
    expect(calendar.remove).toHaveBeenCalledTimes(1);
  });

  it("leaves an entry alone that is no blocker", async () => {
    const calendar = writer([event("b1", A.start, A.end, { processId: undefined, title: "Retraite mit Team" })]);
    const result = await executeProposal(remove, calendar);
    expect(result.entries[0]?.outcome).toBe("refused");
    expect(calendar.remove).not.toHaveBeenCalled();
  });

  it("leaves an entry alone that was moved since the proposal", async () => {
    const calendar = writer([event("b1", "2026-11-23T10:00:00.000Z", "2026-11-23T11:00:00.000Z")]);
    expect((await executeProposal(remove, calendar)).entries[0]?.outcome).toBe("refused");
    expect(calendar.remove).not.toHaveBeenCalled();
  });
});
