import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/lib/calendar/types";
import { zonedTimeToUtc } from "@/lib/time/zoned";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { streamReply } from "./reply";
import { decodeEvents } from "./stream";

/** Builds a server-sent-events response like the Messages API sends it. */
function sse(events: Record<string, unknown>[]): Response {
  const body = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function turn(block: Record<string, unknown>, deltas: Record<string, unknown>[], stopReason: string) {
  const usage = { input_tokens: 1, output_tokens: 1 };
  return sse([
    {
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage },
    },
    { type: "content_block_start", index: 0, content_block: block },
    ...deltas.map((delta) => ({ type: "content_block_delta", index: 0, delta })),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]);
}

const toolInput = {
  from: "2026-11-23",
  to: "2026-11-23",
  duration_minutes: 45,
  count: 1,
  mode: "online",
  earliest: "09:00",
};

describe("streamReply with the real SDK", () => {
  it("runs the slot search when the model calls the tool and hands the result back", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? turn(
            { type: "tool_use", id: "toolu_1", name: "find_free_slots", input: {} },
            [{ type: "input_json_delta", partial_json: JSON.stringify(toolInput) }],
            "tool_use",
          )
        : turn({ type: "text", text: "" }, [{ type: "text_delta", text: "Frei ist Montag um 10 Uhr." }], "end_turn");
    });
    const client = new Anthropic({ apiKey: "test-key", fetch: fetchImpl as unknown as typeof fetch, maxRetries: 0 });
    const meeting: CalendarEvent = {
      id: "e1",
      title: "Projektsitzung",
      start: zonedTimeToUtc("2026-11-23", "09:00", "Europe/Zurich"),
      end: zonedTimeToUtc("2026-11-23", "10:00", "Europe/Zurich"),
      allDay: false,
      hasVideoLink: false,
      transparent: false,
      cancelled: false,
      myResponse: "none",
      optionalForMe: false,
      kind: "default",
      homeOffice: false,
    };
    const loadEvents = vi.fn(async () => [meeting]);

    const { events } = decodeEvents(
      await new Response(
        streamReply([{ role: "user", content: "Ein Slot am Montag?" }], {
          client,
          loadEvents,
          signProposal: (proposal) => ({ proposal, token: "signed" }),
          now: () => new Date("2026-11-20T10:00:00Z"),
        }),
      ).text(),
    );
    const text = events.map((event) => (event.type === "text" ? event.text : "")).join("");

    expect(text).toBe("Frei ist Montag um 10 Uhr.");
    expect(loadEvents).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ model: "claude-opus-5-5", stream: true, fallbacks: "default" });

    const followUp = requests[1]!.messages as { role: string; content: { type: string; content: unknown }[] }[];
    const toolResult = followUp.at(-1)!.content.find((block) => block.type === "tool_result")!;
    const raw = Array.isArray(toolResult.content)
      ? (toolResult.content[0] as { text: string }).text
      : String(toolResult.content);
    expect(JSON.parse(raw).proposals).toMatchObject([
      { weekday: "Montag", start: "10:00", end: "10:45", before: { title: "Projektsitzung", gap_minutes: 0 } },
    ]);
  });
});

describe("streamReply proposals with the real SDK", () => {
  it("shows a signed blocker proposal when the model asks for blockers, and writes nothing", async () => {
    const requests: Record<string, unknown>[] = [];
    const input = {
      title: "Retraite",
      mode: "online",
      slots: [{ date: "2026-11-23", start: "14:00", end: "15:00" }],
    };
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? turn(
            { type: "tool_use", id: "toolu_1", name: "propose_blockers", input: {} },
            [{ type: "input_json_delta", partial_json: JSON.stringify(input) }],
            "tool_use",
          )
        : turn({ type: "text", text: "" }, [{ type: "text_delta", text: "Bitte bestätige den Vorschlag." }], "end_turn");
    });
    const client = new Anthropic({ apiKey: "test-key", fetch: fetchImpl as unknown as typeof fetch, maxRetries: 0 });
    const signProposal = vi.fn((proposal) => ({ proposal, token: "signed-token" }));

    const { events } = decodeEvents(
      await new Response(
        streamReply([{ role: "user", content: "Bitte blocken." }], {
          client,
          loadEvents: vi.fn(async () => []),
          signProposal,
          rules: DEFAULT_RULES,
          now: () => new Date("2026-11-20T10:00:00Z"),
        }),
      ).text(),
    );

    expect(events.map((event) => event.type)).toEqual(["proposal", "text"]);
    expect(events[0]).toMatchObject({
      type: "proposal",
      proposal: {
        token: "signed-token",
        proposal: {
          kind: "createBlockers",
          eventTitle: "Blocker Retraite",
          entries: [{ label: "Montag, 23.11.2026, 14:00–15:00", status: "free" }],
        },
      },
    });
    expect(signProposal).toHaveBeenCalledTimes(1);
    // Only the two model calls went out: no request to the calendar.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
