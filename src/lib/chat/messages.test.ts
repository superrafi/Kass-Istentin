import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGES, parseChatRequest } from "./messages";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("parseChatRequest", () => {
  it("accepts a single user message", () => {
    expect(parseChatRequest({ messages: [user("Hallo")] })).toEqual({
      ok: true,
      messages: [{ role: "user", content: "Hallo" }],
    });
  });

  it("accepts an alternating history and drops unknown fields", () => {
    const result = parseChatRequest({
      messages: [user("a"), assistant("b"), { ...user("c"), extra: 1 }],
    });
    expect(result).toEqual({
      ok: true,
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
      ],
    });
  });

  it.each([
    ["no body", null],
    ["no messages", {}],
    ["empty list", { messages: [] }],
    ["not a list", { messages: "Hallo" }],
    ["starts with assistant", { messages: [assistant("a")] }],
    ["ends with assistant", { messages: [user("a"), assistant("b")] }],
    ["two user messages in a row", { messages: [user("a"), user("b"), user("c")] }],
    ["system role", { messages: [{ role: "system", content: "a" }] }],
    ["blank content", { messages: [user("  ")] }],
    ["non-text content", { messages: [{ role: "user", content: [] }] }],
    ["too long", { messages: [user("x".repeat(MAX_MESSAGE_LENGTH + 1))] }],
    [
      "too many",
      {
        messages: Array.from({ length: MAX_MESSAGES + 1 }, (_, i) =>
          i % 2 === 0 ? user("a") : assistant("b"),
        ),
      },
    ],
  ])("rejects %s", (_name, body) => {
    expect(parseChatRequest(body).ok).toBe(false);
  });
});
