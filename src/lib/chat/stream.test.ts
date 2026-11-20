import { describe, expect, it } from "vitest";
import { decodeEvents, encodeEvent } from "./stream";

describe("chat stream", () => {
  it("round-trips events, also text with line breaks", () => {
    const sent = encodeEvent({ type: "text", text: "Zeile 1\nZeile 2" }) + encodeEvent({ type: "text", text: "!" });
    expect(decodeEvents(sent)).toEqual({
      events: [
        { type: "text", text: "Zeile 1\nZeile 2" },
        { type: "text", text: "!" },
      ],
      rest: "",
    });
  });

  it("keeps an unfinished line for the next chunk", () => {
    const line = encodeEvent({ type: "text", text: "Hallo" });
    const first = decodeEvents(line.slice(0, 10));
    expect(first.events).toEqual([]);
    expect(decodeEvents(first.rest + line.slice(10)).events).toEqual([{ type: "text", text: "Hallo" }]);
  });
});
