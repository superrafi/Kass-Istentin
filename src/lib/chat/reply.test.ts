import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { PLACEHOLDER_REPLY, REFUSAL_REPLY, streamReply, SYSTEM_PROMPT } from "./reply";

const history = [{ role: "user" as const, content: "Hallo" }];

function fakeClient(chunks: string[], stopReason = "end_turn", failure?: Error) {
  const stream = vi.fn((_params: Record<string, unknown>) => {
    let onText: (text: string) => void = () => {};
    return {
      on(_event: string, handler: (text: string) => void) {
        onText = handler;
      },
      async finalMessage() {
        chunks.forEach((chunk) => onText(chunk));
        if (failure) throw failure;
        return { stop_reason: stopReason };
      },
    };
  });
  return { client: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
}

const read = (stream: ReadableStream<Uint8Array>) => new Response(stream).text();

describe("streamReply", () => {
  it("answers with the placeholder when no API key is set", async () => {
    expect(await read(streamReply(history))).toBe(PLACEHOLDER_REPLY);
  });

  it("streams the model's text and sends history and system prompt", async () => {
    const { client, stream } = fakeClient(["Gu", "ten Tag"]);
    expect(await read(streamReply(history, { client }))).toBe("Guten Tag");
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      system: SYSTEM_PROMPT,
      messages: history,
    });
  });

  it("explains a refusal instead of returning nothing", async () => {
    const { client } = fakeClient([], "refusal");
    expect(await read(streamReply(history, { client }))).toBe(REFUSAL_REPLY);
  });

  it("appends an error note when the model call fails", async () => {
    const { client } = fakeClient(["Teil"], "end_turn", new Error("boom"));
    const text = await read(streamReply(history, { client }));
    expect(text.startsWith("Teil\n\n")).toBe(true);
    expect(text).toContain("Fehler");
  });
});
