export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** A picture attached to a user message, e.g. a screenshot of a poll. */
export interface ChatImage {
  mediaType: ImageType;
  /** Base64 without the data-URL prefix. */
  data: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  images?: ChatImage[];
}

export const MAX_MESSAGES = 60;
export const MAX_MESSAGE_LENGTH = 8000;
export const MAX_IMAGES_PER_MESSAGE = 4;
/** About 5 MB per picture, counted in base64 characters. */
export const MAX_IMAGE_CHARS = 7_000_000;
/** Text used for a message that consists of pictures only. */
export const IMAGE_ONLY_TEXT = "(Bild)";

export type ParseResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string };

function parseImages(raw: unknown): ChatImage[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return "images must be a list";
  if (raw.length > MAX_IMAGES_PER_MESSAGE) return "too many images";
  const images: ChatImage[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return "invalid image";
    const { mediaType, data } = entry as Record<string, unknown>;
    const type = IMAGE_TYPES.find((known) => known === mediaType);
    if (!type) return "unsupported image type";
    if (typeof data !== "string" || data === "" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      return "image data must be base64";
    }
    if (data.length > MAX_IMAGE_CHARS) return "image too large";
    images.push({ mediaType: type, data });
  }
  return images;
}

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
    const { role, content, images: rawImages } = entry as Record<string, unknown>;
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (role !== expectedRole) {
      return { ok: false, error: "messages must alternate, starting with user" };
    }
    const images = parseImages(expectedRole === "user" ? rawImages : undefined);
    if (typeof images === "string") return { ok: false, error: images };
    if (typeof content !== "string") {
      return { ok: false, error: "message content must be text" };
    }
    if (content.trim() === "" && images.length === 0) {
      return { ok: false, error: "message content must be non-empty text" };
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: "message too long" };
    }
    messages.push({
      role: expectedRole,
      content: content.trim() === "" ? IMAGE_ONLY_TEXT : content,
      ...(images.length > 0 ? { images } : {}),
    });
  }

  if (messages.length % 2 === 0) {
    return { ok: false, error: "last message must be from user" };
  }
  return { ok: true, messages };
}
