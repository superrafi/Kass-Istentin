import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { PersonRules } from "@/lib/rules/rules";
import { type EventLoader, searchSlots } from "@/lib/slots/service";

const CALENDAR_HELP = {
  notConnected:
    "Kein Zugriff auf den Kalender. Die Person muss sich abmelden, neu anmelden und dabei den Kalenderzugriff erlauben.",
  apiDisabled:
    "Die Google Calendar API ist im Cloud-Projekt nicht eingeschaltet. Das muss die Person beheben, die die App betreibt.",
  unavailable: "Der Kalender ist gerade nicht erreichbar. Später nochmals versuchen.",
} as const;

const date = z.string().describe("Datum in der Form YYYY-MM-DD");
const time = z.string().describe("Uhrzeit in der Form HH:MM, 24 Stunden");

/**
 * The slot search as a tool. The model fills in the request; whether a time
 * is free is decided by the search code alone.
 */
export function findFreeSlotsTool(loadEvents: EventLoader, rules: PersonRules, now: () => Date) {
  return betaZodTool({
    name: "find_free_slots",
    description:
      "Sucht freie Zeiten im Kalender der Person nach ihren Regeln. Liefert Vorschläge mit dem Umfeld " +
      "(Termin davor und danach) und pro Tag den Grund, falls nichts frei ist. Das ist die einzige " +
      "Quelle dafür, ob eine Zeit frei ist.",
    inputSchema: z.object({
      from: date.describe("Erster Tag der Suche, YYYY-MM-DD"),
      to: date.describe("Letzter Tag der Suche (eingeschlossen), YYYY-MM-DD"),
      duration_minutes: z.number().int().describe("Dauer des Termins in Minuten"),
      count: z.number().int().describe("Gewünschte Anzahl Vorschläge"),
      mode: z
        .enum(["online", "onsite"])
        .describe("online für Calls, onsite für Termine vor Ort. An Homeoffice-Tagen ist nur online möglich."),
      earliest: time.optional().describe("Früheste Startzeit, zum Beispiel 09:00 für «nicht vor 9 Uhr»"),
      latest: time.optional().describe("Späteste Endzeit, HH:MM"),
      avoid_lunch: z.boolean().optional().describe("true für «nicht über Mittag»"),
    }),
    run: async (input) => {
      const outcome = await searchSlots(
        {
          from: input.from,
          to: input.to,
          durationMinutes: input.duration_minutes,
          count: input.count,
          mode: input.mode,
          earliest: input.earliest,
          latest: input.latest,
          avoidLunch: input.avoid_lunch,
        },
        loadEvents,
        rules,
        now(),
      );
      if (outcome.ok) return JSON.stringify(outcome.result);
      if (outcome.error === "invalidRequest") {
        return JSON.stringify({ error: "invalid_request", detail: outcome.detail });
      }
      return JSON.stringify({ error: "calendar", detail: CALENDAR_HELP[outcome.problem] });
    },
  });
}
