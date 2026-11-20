import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { CalendarAccessError } from "@/lib/calendar/google";
import { checkSlots, pollPeriod, type PollSlot, type SlotFinding, validatePollSlots } from "@/lib/polls/check";
import {
  buildCreateProposal,
  buildDeleteProposal,
  cleanProcessTitle,
  collectProcesses,
  spanLabel,
} from "@/lib/processes/blockers";
import type { Proposal } from "@/lib/proposals/types";
import type { PersonRules } from "@/lib/rules/rules";
import { type EventLoader, searchSlots } from "@/lib/slots/service";
import { addDays, localDateOf, zonedTimeToUtc } from "@/lib/time/zoned";

/** How far ahead blockers are looked for. */
const PROCESS_HORIZON_DAYS = 180;

const CALENDAR_HELP = {
  notConnected:
    "Kein Zugriff auf den Kalender. Die Person muss sich abmelden, neu anmelden und dabei den Kalenderzugriff erlauben.",
  apiDisabled:
    "Die Google Calendar API ist im Cloud-Projekt nicht eingeschaltet. Das muss die Person beheben, die die App betreibt.",
  unavailable: "Der Kalender ist gerade nicht erreichbar. Später nochmals versuchen.",
} as const;

const NOT_WRITTEN =
  "Der Vorschlag wird der Person jetzt mit Schaltflächen angezeigt. Es ist noch nichts im Kalender geändert. " +
  "Geschrieben wird erst, wenn die Person den Vorschlag bestätigt.";

export interface ToolContext {
  loadEvents: EventLoader;
  rules: PersonRules;
  now: () => Date;
  /** Shows a proposal to the person. Writing happens only after they confirm it. */
  showProposal: (proposal: Proposal) => void;
  newId: () => string;
}

const date = z.string().describe("Datum in der Form YYYY-MM-DD");
const time = z.string().describe("Uhrzeit in der Form HH:MM, 24 Stunden");
const mode = z
  .enum(["online", "onsite"])
  .describe("online für Calls, onsite für Termine vor Ort. An Homeoffice-Tagen ist nur online möglich.");
const slot = z.object({ date, start: time, end: time });
const slots = z.array(slot).describe("Die Slots der Umfrage in Ortszeit der Person");
const processRef = z
  .string()
  .describe("Kennung eines Vorgangs aus list_processes (Feld ref)");

/** Runs a tool body and turns calendar problems into an answer the model can pass on. */
async function answer(body: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await body());
  } catch (error) {
    if (error instanceof CalendarAccessError) {
      return JSON.stringify({ error: "calendar", detail: CALENDAR_HELP[error.problem] });
    }
    throw error;
  }
}

function presentFinding(finding: SlotFinding, timeZone: string) {
  return {
    slot: spanLabel(finding.start, finding.end, timeZone),
    status: finding.status,
    ...(finding.alreadyBlocked ? { already_blocked: true } : {}),
    reasons: finding.reasons.map((reason) => ({
      code: reason.code,
      ...(reason.event
        ? {
            entry: reason.event.title.slice(0, 120),
            ...(reason.event.allDay ? { all_day: true } : { when: spanLabel(reason.event.start, reason.event.end, timeZone) }),
            ...(reason.event.location ? { location: reason.event.location.slice(0, 120) } : {}),
          }
        : {}),
    })),
  };
}

async function findings(context: ToolContext, pollSlots: PollSlot[], meetingMode: "online" | "onsite", processId?: string) {
  const events = await context.loadEvents(pollPeriod(pollSlots, context.rules.timeZone));
  return checkSlots(pollSlots, events, context.rules, context.now(), { mode: meetingMode, processId });
}

async function loadProcesses(context: ToolContext) {
  const today = localDateOf(context.now(), context.rules.timeZone);
  const events = await context.loadEvents({
    start: zonedTimeToUtc(today, "00:00", context.rules.timeZone),
    end: zonedTimeToUtc(addDays(today, PROCESS_HORIZON_DAYS), "00:00", context.rules.timeZone),
  });
  return collectProcesses(events);
}

/**
 * The tools of the assistant. The model fills in requests and words results;
 * whether a time is free and what gets written is decided by code. No tool
 * writes to the calendar: the writing tools only show a proposal.
 */
export function assistantTools(context: ToolContext) {
  const { rules } = context;

  const findFreeSlots = betaZodTool({
    name: "find_free_slots",
    description:
      "Sucht freie Zeiten im Kalender der Person nach ihren Regeln. Liefert Vorschläge mit dem Umfeld " +
      "(Termin davor und danach) und pro Tag den Grund, falls nichts frei ist. Für die Suche nach neuen Zeiten.",
    inputSchema: z.object({
      from: date.describe("Erster Tag der Suche, YYYY-MM-DD"),
      to: date.describe("Letzter Tag der Suche (eingeschlossen), YYYY-MM-DD"),
      duration_minutes: z.number().int().describe("Dauer des Termins in Minuten"),
      count: z.number().int().describe("Gewünschte Anzahl Vorschläge"),
      mode,
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
        context.loadEvents,
        rules,
        context.now(),
      );
      if (outcome.ok) return JSON.stringify(outcome.result);
      if (outcome.error === "invalidRequest") {
        return JSON.stringify({ error: "invalid_request", detail: outcome.detail });
      }
      return JSON.stringify({ error: "calendar", detail: CALENDAR_HELP[outcome.problem] });
    },
  });

  const checkPollSlots = betaZodTool({
    name: "check_poll_slots",
    description:
      "Prüft vorgegebene Slots, zum Beispiel aus einer Terminumfrage, gegen den Kalender, inklusive Umfeld. " +
      "Liefert pro Slot den Befund free, busy oder uncertain mit Begründung.",
    inputSchema: z.object({
      slots,
      mode,
      process_ref: processRef.optional().describe(
        "Nur wenn die Slots zu einem bestehenden Vorgang gehören: dessen ref. Dessen eigene Blocker gelten dann nicht als Konflikt.",
      ),
    }),
    run: (input) =>
      answer(async () => {
        const problem = validatePollSlots(input.slots);
        if (problem) return { error: "invalid_request", detail: problem };
        const result = await findings(context, input.slots, input.mode, input.process_ref);
        return { findings: result.map((finding) => presentFinding(finding, rules.timeZone)) };
      }),
  });

  const proposeBlockers = betaZodTool({
    name: "propose_blockers",
    description:
      "Schlägt der Person Blocker für Slots einer Umfrage vor. Prüft die Slots selbst nochmals und lässt besetzte " +
      "und bereits geblockte weg. Trägt nichts ein: Die Person sieht den Vorschlag und bestätigt ihn selbst.",
    inputSchema: z.object({
      title: z
        .string()
        .describe("Kurzer Name des Vorgangs, zum Beispiel «Retraite Team». Die Blocker heissen dann «Blocker Retraite Team»."),
      slots,
      mode,
      process_ref: processRef.optional().describe("Nur um einem bestehenden Vorgang weitere Blocker hinzuzufügen: dessen ref."),
    }),
    run: (input) =>
      answer(async () => {
        const problem = validatePollSlots(input.slots);
        if (problem) return { error: "invalid_request", detail: problem };
        if (!cleanProcessTitle(input.title)) return { error: "invalid_request", detail: "title is empty" };

        // Hand-made blockers have no id; new blockers for them start a process of their own.
        const existing = input.process_ref && !input.process_ref.startsWith("title:") ? input.process_ref : undefined;
        const processId = existing ?? context.newId();
        const result = await findings(context, input.slots, input.mode, processId);
        const { proposal, skipped } = buildCreateProposal({ id: processId, title: input.title }, result, rules.timeZone);
        if (!proposal) return { proposed: [], skipped, note: "Kein Slot ist frei. Es wurde nichts vorgeschlagen." };

        context.showProposal(proposal);
        return {
          proposed: proposal.entries.map((entry) => ({ slot: entry.label, status: entry.status, notes: entry.notes })),
          skipped,
          note: NOT_WRITTEN,
        };
      }),
  });

  const listProcesses = betaZodTool({
    name: "list_processes",
    description:
      `Listet die offenen Vorgänge der nächsten ${PROCESS_HORIZON_DAYS} Tage mit ihren Blockern. Ein Vorgang ist eine ` +
      "Abstimmung, zum Beispiel eine Umfrage. Auch von Hand angelegte Einträge mit «Blocker» im Titel erscheinen (manual).",
    inputSchema: z.object({}),
    run: () =>
      answer(async () => ({
        processes: (await loadProcesses(context)).map((process) => ({
          ref: process.ref,
          title: process.title,
          ...(process.manual ? { manual: true } : {}),
          blockers: process.blockers.map((blocker) => spanLabel(blocker.start, blocker.end, rules.timeZone)),
        })),
      })),
  });

  const proposeBlockerCleanup = betaZodTool({
    name: "propose_blocker_cleanup",
    description:
      "Schlägt der Person vor, die Blocker eines Vorgangs zu löschen, zum Beispiel nachdem der Termin bestätigt ist. " +
      "Löscht nichts: Die Person sieht den Vorschlag und bestätigt ihn selbst.",
    inputSchema: z.object({
      process_ref: processRef,
      keep: slot
        .optional()
        .describe("Der bestätigte Termin. Sein Blocker bleibt stehen. Weglassen, um alle Blocker des Vorgangs zu löschen."),
    }),
    run: (input) =>
      answer(async () => {
        if (input.keep) {
          const problem = validatePollSlots([input.keep]);
          if (problem) return { error: "invalid_request", detail: problem };
        }
        const process = (await loadProcesses(context)).find((candidate) => candidate.ref === input.process_ref);
        if (!process) return { error: "unknown_process", detail: "Kein Vorgang mit dieser ref. Ruf list_processes auf." };
        const proposal = buildDeleteProposal(process, rules.timeZone, input.keep);
        if (!proposal) return { to_delete: [], note: "Es gibt keine Blocker zu löschen." };

        context.showProposal(proposal);
        return {
          to_delete: proposal.entries.map((entry) => entry.label),
          kept: proposal.kept.map((entry) => entry.label),
          ...(input.keep && proposal.kept.length === 0
            ? { warning: "Zum bestätigten Termin gibt es keinen Blocker. Alle Blocker des Vorgangs würden gelöscht." }
            : {}),
          note: NOT_WRITTEN,
        };
      }),
  });

  return [findFreeSlots, checkPollSlots, proposeBlockers, listProcesses, proposeBlockerCleanup];
}
