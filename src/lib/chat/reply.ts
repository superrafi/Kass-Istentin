import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "./messages";

const MODEL = "claude-opus-5-5";

export const SYSTEM_PROMPT = `Du bist Kass-Istentin, eine Assistentin für Terminkoordination rund um Kalender und Mail.

Stand der App: Du hast noch keinen Zugriff auf Kalender oder Mail. Sag das offen, wenn jemand nach freien Zeiten, Terminen oder Mails fragt, und erfinde nie Kalenderinhalte oder freie Slots. Ob eine Zeit frei ist, rechnet später normaler Code nach festen Regeln, nicht du.

Schreib Deutsch in Schweizer Schreibweise (kein ß) und in der Du-Form. Antworte kurz und sachlich. Frag im Zweifel nach, statt zu raten.`;

export const PLACEHOLDER_REPLY =
  "Ich bin noch nicht mit dem Sprachmodell verbunden (es ist kein API-Schlüssel gesetzt). " +
  "Login und Chat funktionieren aber: Deine Nachricht ist angekommen.";

export const REFUSAL_REPLY = "Dazu kann ich leider nichts sagen.";

export type TextStream = ReadableStream<Uint8Array>;

function textStream(text: string): TextStream {
  return new Response(text).body!;
}

function errorNote(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Der API-Schlüssel für das Sprachmodell ist ungültig.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Das Sprachmodell ist gerade ausgelastet. Versuch es in einer Minute nochmals.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Das Sprachmodell ist nicht erreichbar. Versuch es nochmals.";
  }
  return "Bei der Antwort ist ein Fehler aufgetreten. Versuch es nochmals.";
}

/**
 * Streams the assistant's answer as plain UTF-8 text. Without an API key the
 * answer is a fixed placeholder, so the app and its tests run without secrets.
 */
export function streamReply(
  messages: ChatMessage[],
  options: { apiKey?: string; client?: Anthropic; signal?: AbortSignal } = {},
): TextStream {
  if (!options.apiKey && !options.client) {
    return textStream(PLACEHOLDER_REPLY);
  }
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentText = false;
      const send = (text: string) => {
        if (!text) return;
        sentText = true;
        controller.enqueue(encoder.encode(text));
      };

      try {
        const stream = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 64000,
            output_config: { effort: "medium" },
            // If the model declines for policy reasons, the API retries on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM_PROMPT,
            messages,
          },
          { signal: options.signal },
        );
        stream.on("text", send);
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal" && !sentText) {
          send(REFUSAL_REPLY);
        }
      } catch (error) {
        if (!options.signal?.aborted) {
          console.error("chat reply failed", error instanceof Error ? error.name : error);
          send(`${sentText ? "\n\n" : ""}${errorNote(error)}`);
        }
      } finally {
        controller.close();
      }
    },
  });
}
