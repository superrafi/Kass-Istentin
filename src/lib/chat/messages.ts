export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const MAX_MESSAGES = 60;
export const MAX_MESSAGE_LENGTH = 8000;

export type ParseResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

/**
 * Validates the chat history sent by the browser. The history must alternate
 * between user and assistant and end with a user message.
 */
export function parseChatRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || !("messages" in body)) {
    return { ok: false, error: "messages missing" };
  }
  const raw = (body as { messages: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "messages must be a non-empty list" };
  }
  if (raw.length > MAX_MESSAGES) {
    return { ok: false, error: "too many messages" };
  }

  const messages: ChatMessage[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, error: "invalid message" };
    }
    const { role, content } = entry as Record<string, unknown>;
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (role !== expectedRole) {
      return { ok: false, error: "messages must alternate, starting with user" };
    }
    if (typeof content !== "string" || content.trim() === "") {
      return { ok: false, error: "message content must be non-empty text" };
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: "message too long" };
    }
    messages.push({ role: expectedRole, content });
  }

  if (messages.length % 2 === 0) {
    return { ok: false, error: "last message must be from user" };
  }
  return { ok: true, messages };
}
