import { describe, expect, it, vi } from "vitest";
import {
  CalendarAccessError,
  deleteEvent,
  getEvent,
  type GoogleEvent,
  insertBlocker,
  listEvents,
  normalizeEvent,
} from "./google";

const TZ = "Europe/Zurich";
const timed: GoogleEvent = {
  id: "a1",
  summary: " Projektsitzung ",
  start: { dateTime: "2026-11-23T09:00:00+01:00" },
  end: { dateTime: "2026-11-23T10:00:00+01:00" },
};

describe("normalizeEvent", () => {
  it("reads a plain timed entry", () => {
    expect(normalizeEvent(timed, TZ)).toEqual({
      id: "a1",
      title: "Projektsitzung",
      start: new Date("2026-11-23T08:00:00Z"),
      end: new Date("2026-11-23T09:00:00Z"),
      allDay: false,
      hasVideoLink: false,
      transparent: false,
      cancelled: false,
      myResponse: "none",
      optionalForMe: false,
      kind: "default",
      homeOffice: false,
    });
  });

  it("runs all-day entries from local midnight to local midnight", () => {
    const event = normalizeEvent(
      { id: "a2", summary: "Homeoffice", start: { date: "2026-07-15" }, end: { date: "2026-07-16" }, transparency: "transparent" },
      TZ,
    );
    expect(event).toMatchObject({
      allDay: true,
      transparent: true,
      start: new Date("2026-07-14T22:00:00Z"),
      end: new Date("2026-07-15T22:00:00Z"),
    });
  });

  it("reads the person's own answer and optional attendance", () => {
    const event = normalizeEvent(
      {
        ...timed,
        attendees: [
          { responseStatus: "accepted" },
          { self: true, responseStatus: "tentative", optional: true },
        ],
      },
      TZ,
    );
    expect(event).toMatchObject({ myResponse: "tentative", optionalForMe: true });
  });

  it.each([
    ["a Meet link", { hangoutLink: "https://meet.google.com/abc-defg-hij" }],
    ["conference data", { conferenceData: { entryPoints: [{ entryPointType: "video" }] } }],
    ["a Teams link in the description", { description: "<a href=\"https://teams.microsoft.com/l/meetup-join/x\">Beitreten</a>" }],
    ["a Zoom link as location", { location: "https://example.zoom.us/j/123" }],
  ])("detects a video call from %s", (_name, extra) => {
    expect(normalizeEvent({ ...timed, ...extra }, TZ)?.hasVideoLink).toBe(true);
  });

  it("does not treat a meeting link as a place", () => {
    const event = normalizeEvent({ ...timed, location: "https://example.zoom.us/j/123" }, TZ);
    expect(event?.location).toBeUndefined();
  });

  it("keeps a real place next to a video link", () => {
    const event = normalizeEvent(
      { ...timed, location: "Musterstrasse 1, Bern", hangoutLink: "https://meet.google.com/abc" },
      TZ,
    );
    expect(event).toMatchObject({ location: "Musterstrasse 1, Bern", hasVideoLink: true });
  });

  it("reads status, special kinds and the process id", () => {
    expect(normalizeEvent({ ...timed, status: "cancelled" }, TZ)?.cancelled).toBe(true);
    expect(normalizeEvent({ ...timed, eventType: "outOfOffice" }, TZ)?.kind).toBe("outOfOffice");
    expect(
      normalizeEvent(
        { ...timed, eventType: "workingLocation", workingLocationProperties: { type: "homeOffice" } },
        TZ,
      ),
    ).toMatchObject({ kind: "workingLocation", homeOffice: true });
    expect(
      normalizeEvent({ ...timed, extendedProperties: { private: { kassVorgang: "p1" } } }, TZ)?.processId,
    ).toBe("p1");
  });

  it("names entries without a title", () => {
    expect(normalizeEvent({ ...timed, summary: undefined }, TZ)?.title).toBe("(ohne Titel)");
  });

  it("drops entries without id or usable times", () => {
    expect(normalizeEvent({ ...timed, id: undefined }, TZ)).toBeNull();
    expect(normalizeEvent({ ...timed, end: undefined }, TZ)).toBeNull();
    expect(normalizeEvent({ ...timed, end: timed.start }, TZ)).toBeNull();
  });
});

describe("listEvents", () => {
  const period = { start: new Date("2026-11-23T00:00:00Z"), end: new Date("2026-11-28T00:00:00Z") };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("follows pages and sends the token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ items: [timed], nextPageToken: "next" }))
      .mockResolvedValueOnce(json({ items: [{ ...timed, id: "a2" }, { summary: "kaputt" }] }));
    const events = await listEvents("token-1", period, TZ, fetchImpl);

    expect(events.map((event) => event.id)).toEqual(["a1", "a2"]);
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0]!;
    expect(String(firstUrl)).toContain("singleEvents=true");
    expect(String(firstUrl)).toContain("timeMin=2026-11-23T00%3A00%3A00.000Z");
    expect(firstInit?.headers).toEqual({ Authorization: "Bearer token-1" });
    expect(String(fetchImpl.mock.calls[1]![0])).toContain("pageToken=next");
  });

  it.each([
    [401, {}, "notConnected"],
    [403, { error: { errors: [{ reason: "insufficientPermissions" }] } }, "notConnected"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "apiDisabled"],
    [500, {}, "unavailable"],
  ])("maps status %i to a problem", async (status, body, problem) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(body, status));
    await expect(listEvents("t", period, TZ, fetchImpl)).rejects.toMatchObject({ problem });
  });

  it("reports a network failure as unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(listEvents("t", period, TZ, fetchImpl)).rejects.toBeInstanceOf(CalendarAccessError);
  });

  it("gives up instead of answering from half a calendar", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => json({ items: [], nextPageToken: "more" }));
    await expect(listEvents("t", period, TZ, fetchImpl)).rejects.toMatchObject({ problem: "unavailable" });
  });
});

describe("writing", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("creates a blocker that is busy, silent and linked to its process", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "new-1" }));
    const id = await insertBlocker(
      "token-1",
      {
        title: "Blocker Retraite",
        start: new Date("2026-11-23T09:00:00Z"),
        end: new Date("2026-11-23T10:00:00Z"),
        processId: "p1",
        description: "Angelegt von Kass-Istentin.",
      },
      fetchImpl,
    );

    expect(id).toBe("new-1");
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      summary: "Blocker Retraite",
      description: "Angelegt von Kass-Istentin.",
      start: { dateTime: "2026-11-23T09:00:00.000Z" },
      end: { dateTime: "2026-11-23T10:00:00.000Z" },
      transparency: "opaque",
      reminders: { useDefault: false },
      extendedProperties: { private: { kassVorgang: "p1" } },
    });
  });

  it("reports missing write access when creating", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({}, 403));
    await expect(
      insertBlocker("t", { title: "x", start: new Date(0), end: new Date(1), processId: "p", description: "" }, fetchImpl),
    ).rejects.toMatchObject({ problem: "notConnected" });
  });

  it("loads one entry and returns null for missing or cancelled ones", async () => {
    const found = vi.fn<typeof fetch>().mockResolvedValue(json(timed));
    expect((await getEvent("t", "a1", TZ, found))?.id).toBe("a1");
    expect(String(found.mock.calls[0]![0])).toContain("/events/a1?");

    const missing = vi.fn<typeof fetch>().mockResolvedValue(json({}, 404));
    expect(await getEvent("t", "a1", TZ, missing)).toBeNull();
    const cancelled = vi.fn<typeof fetch>().mockResolvedValue(json({ ...timed, status: "cancelled" }));
    expect(await getEvent("t", "a1", TZ, cancelled)).toBeNull();
  });

  it("deletes an entry without notifying anyone and accepts that it is already gone", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await deleteEvent("t", "a 1", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain("/events/a%201?sendUpdates=none");
    expect(init?.method).toBe("DELETE");

    const gone = vi.fn<typeof fetch>().mockResolvedValue(json({}, 410));
    await expect(deleteEvent("t", "a1", gone)).resolves.toBeUndefined();
    const failing = vi.fn<typeof fetch>().mockResolvedValue(json({}, 500));
    await expect(deleteEvent("t", "a1", failing)).rejects.toBeInstanceOf(CalendarAccessError);
  });
});
