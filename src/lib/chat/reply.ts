import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_RULES, type PersonRules } from "@/lib/rules/rules";
import { weekdayName } from "@/lib/slots/present";
import type { EventLoader } from "@/lib/slots/service";
import { localDateOf, localTimeOf } from "@/lib/time/zoned";
import type { ChatMessage } from "./messages";
import { findFreeSlotsTool } from "./tools";

const MODEL = "claude-opus-5-5";
/** Upper bound for model turns per answer, so a tool loop cannot run away. */
const MAX_TURNS = 8;

export function buildSystemPrompt(now: Date, rules: PersonRules): string {
  const today = localDateOf(now, rules.timeZone);
  return `Du bist Kass-Istentin, eine Assistentin für Terminkoordination rund um Kalender und Mail.

Heute ist ${weekdayName(today)}, ${today}, ${localTimeOf(now, rules.timeZone)} Uhr (${rules.timeZone}). Wochen beginnen am Montag.

Du kannst den Kalender der Person lesen, aber nur über das Werkzeug find_free_slots. Ob eine Zeit frei ist, rechnet dieses Werkzeug nach festen Regeln. Nenn nie eine Zeit als frei, die nicht aus seinem Ergebnis stammt, und erfinde keine Kalenderinhalte. Kalendereinträge anlegen, ändern oder löschen kannst du noch nicht, auf Mail greifst du noch nicht zu. Sag das offen, wenn jemand danach fragt.

Zur Slot-Suche:
- Fehlt die Dauer oder der Zeitraum, frag nach. Ist unklar, ob der Termin online oder vor Ort stattfindet, such für einen Call und sag, dass du das angenommen hast.
- Nenn zu jedem Vorschlag Wochentag, Datum und Uhrzeit und das Umfeld: was direkt davor und danach liegt, mit Ort, wenn einer angegeben ist. Liegt davor oder danach ein Termin an einem anderen Ort mit wenig Abstand, weis darauf hin. Reisezeit rechnest du noch nicht.
- Überlagert ein Vorschlag einen verschiebbaren oder nur vorläufig zugesagten Termin (overlaps), sag das dazu.
- Begründe kurz die Tage im Suchzeitraum, an denen nichts frei ist (blocked_by). Tage mit Status available sind frei, wurden aber nicht gebraucht.
- Gibt es weniger Vorschläge als gewünscht, sag das und schlag vor, wie sich die Suche erweitern lässt.

Schreib Deutsch in Schweizer Schreibweise (kein ß) und in der Du-Form. Antworte kurz und sachlich. Frag im Zweifel nach, statt zu raten.`;
}

export const PLACEHOLDER_REPLY =
  "Ich bin noch nicht mit dem Sprachmodell verbunden (es ist kein API-Schlüssel gesetzt). " +
  "Login und Chat funktionieren aber: Deine Nachricht ist angekommen.";

export const REFUSAL_REPLY = "Dazu kann ich leider nichts sagen.";

export type TextStream = ReadableStream<Uint8Array>;

export interface ReplyOptions {
  apiKey?: string;
  client?: Anthropic;
  signal?: AbortSignal;
  /** Loads calendar entries for the signed-in person. */
  loadEvents: EventLoader;
  rules?: PersonRules;
  now?: () => Date;
}

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
export function streamReply(messages: ChatMessage[], options: ReplyOptions): TextStream {
  if (!options.apiKey && !options.client) {
    return textStream(PLACEHOLDER_REPLY);
  }
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const rules = options.rules ?? DEFAULT_RULES;
  const now = options.now ?? (() => new Date());
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
        const runner = client.beta.messages.toolRunner(
          {
            model: MODEL,
            max_tokens: 64000,
            output_config: { effort: "medium" },
            // If the model declines for policy reasons, the API retries on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: buildSystemPrompt(now(), rules),
            tools: [findFreeSlotsTool(options.loadEvents, rules, now)],
            messages,
            stream: true,
            max_iterations: MAX_TURNS,
          },
          { signal: options.signal },
        );

        for await (const turn of runner) {
          // Text before and after a tool call belongs to separate paragraphs.
          let startedTurn = false;
          for await (const event of turn) {
            if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
            if (!startedTurn && sentText) send("\n\n");
            startedTurn = true;
            send(event.delta.text);
          }
          const message = await turn.finalMessage();
          if (message.stop_reason === "refusal") {
            if (!sentText) send(REFUSAL_REPLY);
            break;
          }
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
