import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { Proposal, SignedProposal } from "@/lib/proposals/types";
import { DEFAULT_RULES, type PersonRules } from "@/lib/rules/rules";
import { weekdayName } from "@/lib/slots/present";
import type { EventLoader } from "@/lib/slots/service";
import { localDateOf, localTimeOf } from "@/lib/time/zoned";
import type { ChatMessage } from "./messages";
import { encodeEvent, type StreamEvent } from "./stream";
import { assistantTools } from "./tools";

const MODEL = "claude-opus-5-5";
/** Upper bound for model turns per answer, so a tool loop cannot run away. */
const MAX_TURNS = 10;

export function buildSystemPrompt(now: Date, rules: PersonRules): string {
  const today = localDateOf(now, rules.timeZone);
  return `Du bist Kass-Istentin, eine Assistentin für Terminkoordination rund um Kalender und Mail.

Heute ist ${weekdayName(today)}, ${today}, ${localTimeOf(now, rules.timeZone)} Uhr (${rules.timeZone}). Wochen beginnen am Montag.

Du liest den Kalender der Person nur über deine Werkzeuge. Ob eine Zeit frei ist, rechnen sie nach festen Regeln. Nenn nie eine Zeit als frei oder besetzt, die nicht aus einem Werkzeugergebnis stammt, und erfinde keine Kalenderinhalte. Auf Mail greifst du noch nicht zu. Sag das offen, wenn jemand danach fragt.

Schreiben in den Kalender: Du kannst selbst nichts eintragen oder löschen. propose_blockers und propose_blocker_cleanup zeigen der Person einen Vorschlag mit Schaltflächen, und erst ihre Bestätigung dort schreibt in den Kalender. Sag deshalb nie, etwas sei eingetragen oder gelöscht, bevor im Verlauf ein Vermerk in eckigen Klammern das bestätigt. Ein «ja» oder «ok» im Chat ersetzt die Schaltfläche nicht: Weis dann auf sie hin, oder zeig den Vorschlag neu, falls er abgelaufen ist.

Slot-Suche (find_free_slots):
- Fehlt die Dauer oder der Zeitraum, frag nach. Ist unklar, ob der Termin online oder vor Ort stattfindet, such für einen Call und sag, dass du das angenommen hast.
- Nenn zu jedem Vorschlag Wochentag, Datum und Uhrzeit und das Umfeld: was direkt davor und danach liegt, mit Ort, wenn einer angegeben ist. Liegt davor oder danach ein Termin an einem anderen Ort mit wenig Abstand, weis darauf hin. Reisezeit rechnest du noch nicht.
- Überlagert ein Vorschlag einen verschiebbaren oder nur vorläufig zugesagten Termin (overlaps), sag das dazu.
- Begründe kurz die Tage im Suchzeitraum, an denen nichts frei ist (blocked_by). Tage mit Status available sind frei, wurden aber nicht gebraucht.
- Gibt es weniger Vorschläge als gewünscht, sag das und schlag vor, wie sich die Suche erweitern lässt.

Terminumfragen:
- Die Person schickt die Slots als Text oder als Bild einer Umfrage. Lies Datum, Start und Ende jedes Slots sorgfältig. Fehlt das Jahr, nimm das nächste passende Datum. Ist etwas nicht sicher lesbar, zum Beispiel Wochentag und Datum passen nicht zusammen oder das Ende fehlt, frag nach, statt zu raten.
- Prüf die Slots mit check_poll_slots und melde den Befund pro Slot: frei, besetzt oder unsicher, mit der Begründung aus dem Ergebnis.
- Biete danach an, die freien Slots zu blocken. Nach dem Ja der Person rufst du propose_blockers auf. Unsichere Slots nimmst du nur dazu, wenn die Person das will. Frag nach einem kurzen Namen für den Vorgang, wenn er sich nicht aus dem Gespräch ergibt.
- Die Umfrage selbst kannst du nicht ausfüllen. Sag der Person, welche Slots sie dort ankreuzen kann.
- Ist ein Termin bestätigt, such den Vorgang mit list_processes und schlag mit propose_blocker_cleanup vor, die übrigen Blocker zu löschen. Der Blocker des bestätigten Termins bleibt stehen.

Schreib Deutsch in Schweizer Schreibweise (kein ß) und in der Du-Form. Antworte kurz und sachlich. Frag im Zweifel nach, statt zu raten.`;
}

export const PLACEHOLDER_REPLY =
  "Ich bin noch nicht mit dem Sprachmodell verbunden (es ist kein API-Schlüssel gesetzt). " +
  "Login und Chat funktionieren aber: Deine Nachricht ist angekommen.";

export const REFUSAL_REPLY = "Dazu kann ich leider nichts sagen.";

/** Newline-delimited JSON, see `StreamEvent`. */
export type ReplyStream = ReadableStream<Uint8Array>;

export interface ReplyOptions {
  apiKey?: string;
  client?: Anthropic;
  signal?: AbortSignal;
  /** Loads calendar entries for the signed-in person. */
  loadEvents: EventLoader;
  /** Signs a proposal for the signed-in person, so only they can confirm it. */
  signProposal: (proposal: Proposal) => SignedProposal;
  rules?: PersonRules;
  now?: () => Date;
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

function toApiMessage(message: ChatMessage): Anthropic.Beta.BetaMessageParam {
  if (!message.images?.length) return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: [
      ...message.images.map(
        (image): Anthropic.Beta.BetaImageBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.data },
        }),
      ),
      { type: "text", text: message.content },
    ],
  };
}

/**
 * Streams the assistant's answer as events. Without an API key the answer is
 * a fixed placeholder, so the app and its tests run without secrets.
 */
export function streamReply(messages: ChatMessage[], options: ReplyOptions): ReplyStream {
  const encoder = new TextEncoder();
  if (!options.apiKey && !options.client) {
    return new Response(encodeEvent({ type: "text", text: PLACEHOLDER_REPLY })).body!;
  }
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  const rules = options.rules ?? DEFAULT_RULES;
  const now = options.now ?? (() => new Date());

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sentText = false;
      const emit = (event: StreamEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));
      const send = (text: string) => {
        if (!text) return;
        sentText = true;
        emit({ type: "text", text });
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
            tools: assistantTools({
              loadEvents: options.loadEvents,
              rules,
              now,
              showProposal: (proposal) => emit({ type: "proposal", proposal: options.signProposal(proposal) }),
              newId: randomUUID,
            }),
            messages: messages.map(toApiMessage),
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
