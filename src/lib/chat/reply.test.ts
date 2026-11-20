import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { buildSystemPrompt, PLACEHOLDER_REPLY, REFUSAL_REPLY, streamReply } from "./reply";

const history = [{ role: "user" as const, content: "Hallo" }];
const loadEvents = vi.fn(async () => []);
const NOW = new Date("2026-11-20T10:00:00Z");

interface FakeTurn {
  text?: string[];
  stopReason?: string;
  failure?: Error;
}

/** Stands in for the SDK's tool runner: one stream of events per model turn. */
function fakeClient(turns: FakeTurn[]) {
  const toolRunner = vi.fn((_params: Record<string, unknown>) => ({
    async *[Symbol.asyncIterator]() {
      for (const turn of turns) {
        yield {
          async *[Symbol.asyncIterator]() {
            for (const text of turn.text ?? []) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
            }
            if (turn.failure) throw turn.failure;
          },
          async finalMessage() {
            return { stop_reason: turn.stopReason ?? "end_turn" };
          },
        };
      }
    },
  }));
  return { client: { beta: { messages: { toolRunner } } } as unknown as Anthropic, toolRunner };
}

const read = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe("streamReply", () => {
  it("answers with the placeholder when no API key is set", async () => {
    expect(await read(streamReply(history, { loadEvents }))).toBe(PLACEHOLDER_REPLY);
  });

  it("streams the model's text and sends history, system prompt and the slot tool", async () => {
    const { client, toolRunner } = fakeClient([{ text: ["Gu", "ten Tag"] }]);
    expect(await read(streamReply(history, { client, loadEvents, now: () => NOW }))).toBe("Guten Tag");

    const params = toolRunner.mock.calls[0]?.[0] as { tools: { name: string }[] };
    expect(params).toMatchObject({
      system: buildSystemPrompt(NOW, DEFAULT_RULES),
      messages: history,
      stream: true,
    });
    expect(params.tools.map((tool) => tool.name)).toEqual(["find_free_slots"]);
  });

  it("separates text before and after a tool call", async () => {
    const { client } = fakeClient([
      { text: ["Ich schaue nach."], stopReason: "tool_use" },
      { text: ["Frei ist Montag."] },
    ]);
    expect(await read(streamReply(history, { client, loadEvents }))).toBe(
      "Ich schaue nach.\n\nFrei ist Montag.",
    );
  });

  it("explains a refusal instead of returning nothing", async () => {
    const { client } = fakeClient([{ stopReason: "refusal" }]);
    expect(await read(streamReply(history, { client, loadEvents }))).toBe(REFUSAL_REPLY);
  });

  it("appends an error note when the model call fails", async () => {
    const { client } = fakeClient([{ text: ["Teil"], failure: new Error("boom") }]);
    const text = await read(streamReply(history, { client, loadEvents }));
    expect(text.startsWith("Teil\n\n")).toBe(true);
    expect(text).toContain("Fehler");
  });
});

describe("buildSystemPrompt", () => {
  it("tells the model today's date in the person's time zone", () => {
    // 23:30 UTC is already the next day in Zurich.
    const prompt = buildSystemPrompt(new Date("2026-11-22T23:30:00Z"), DEFAULT_RULES);
    expect(prompt).toContain("Heute ist Montag, 2026-11-23, 00:30 Uhr (Europe/Zurich)");
  });
});
