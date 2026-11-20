import { CalendarAccessError, type NewBlocker } from "@/lib/calendar/google";
import type { CalendarEvent } from "@/lib/calendar/types";
import { isBlocker } from "@/lib/processes/blockers";
import type { EntryOutcome, ExecutionResult, Proposal } from "./types";

/** The calendar operations a confirmed proposal may use. */
export interface CalendarWriter {
  list(period: { start: Date; end: Date }): Promise<CalendarEvent[]>;
  insert(blocker: NewBlocker): Promise<string>;
  get(eventId: string): Promise<CalendarEvent | null>;
  remove(eventId: string): Promise<void>;
}

const DESCRIPTION = (processTitle: string) =>
  `Angelegt von Kass-Istentin für den Vorgang «${processTitle}». Wird nach der Zusage wieder gelöscht.`;

async function attempt(action: () => Promise<EntryOutcome>): Promise<EntryOutcome> {
  try {
    return await action();
  } catch (error) {
    // Missing access affects every entry; let the caller report it once.
    if (error instanceof CalendarAccessError && error.problem !== "unavailable") throw error;
    return "failed";
  }
}

/**
 * Writes a confirmed proposal to the calendar, entry by entry. It only
 * creates the blockers listed and only deletes entries that still are
 * blockers at the time shown to the person.
 */
export async function executeProposal(proposal: Proposal, calendar: CalendarWriter): Promise<ExecutionResult> {
  const entries: ExecutionResult["entries"] = [];

  if (proposal.kind === "createBlockers") {
    const starts = proposal.entries.map((entry) => new Date(entry.start).getTime());
    const ends = proposal.entries.map((entry) => new Date(entry.end).getTime());
    // Read again right before writing, so a second confirmation creates no duplicates.
    const existing = await calendar.list({ start: new Date(Math.min(...starts)), end: new Date(Math.max(...ends)) });

    for (const entry of proposal.entries) {
      const start = new Date(entry.start);
      const end = new Date(entry.end);
      const outcome = await attempt(async () => {
        const duplicate = existing.some(
          (event) =>
            event.processId === proposal.processId &&
            !event.cancelled &&
            event.start.getTime() === start.getTime() &&
            event.end.getTime() === end.getTime(),
        );
        if (duplicate) return "exists";
        await calendar.insert({
          title: proposal.eventTitle,
          start,
          end,
          processId: proposal.processId,
          description: DESCRIPTION(proposal.processTitle),
        });
        return "created";
      });
      entries.push({ label: entry.label, outcome });
    }
    return { kind: proposal.kind, entries };
  }

  for (const entry of proposal.entries) {
    const outcome = await attempt(async () => {
      const current = await calendar.get(entry.eventId);
      if (!current) return "gone";
      const unchanged = current.start.toISOString() === entry.start && current.end.toISOString() === entry.end;
      if (!isBlocker(current) || !unchanged) return "refused";
      await calendar.remove(entry.eventId);
      return "deleted";
    });
    entries.push({ label: entry.label, outcome });
  }
  return { kind: proposal.kind, entries };
}
