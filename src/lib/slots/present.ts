import { isoWeekday, type LocalDate, localDateOf, localTimeOf } from "@/lib/time/zoned";
import type { EventNote, SlotSearchResult } from "./search";

const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MAX_TEXT = 120;

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

export function weekdayName(date: LocalDate): string {
  return WEEKDAYS[isoWeekday(date) - 1]!;
}

function presentNote(entry: EventNote, timeZone: string) {
  return {
    title: clip(entry.title),
    ...(entry.allDay
      ? { all_day: true }
      : {
          start: localTimeOf(entry.start, timeZone),
          end: localTimeOf(entry.end, timeZone),
          // Entries can start on an earlier day or end on a later one.
          ...(localDateOf(entry.start, timeZone) !== localDateOf(new Date(entry.end.getTime() - 1), timeZone)
            ? { start_date: localDateOf(entry.start, timeZone), end_date: localDateOf(entry.end, timeZone) }
            : {}),
        }),
    ...(entry.location ? { location: clip(entry.location) } : {}),
    ...(entry.online ? { online: true } : {}),
    reason: entry.reason,
  };
}

/**
 * Turns a search result into plain data with local times, short enough to
 * hand to the language model: titles, times and places only.
 */
export function presentSlotResult(result: SlotSearchResult, timeZone: string) {
  return {
    time_zone: timeZone,
    proposals: result.proposals.map((proposal) => ({
      date: proposal.date,
      weekday: weekdayName(proposal.date),
      start: localTimeOf(proposal.start, timeZone),
      end: localTimeOf(proposal.end, timeZone),
      ...(proposal.before
        ? { before: { ...presentNote(proposal.before, timeZone), gap_minutes: proposal.before.gapMinutes } }
        : {}),
      ...(proposal.after
        ? { after: { ...presentNote(proposal.after, timeZone), gap_minutes: proposal.after.gapMinutes } }
        : {}),
      ...(proposal.overlaps.length > 0
        ? { overlaps: proposal.overlaps.map((entry) => presentNote(entry, timeZone)) }
        : {}),
    })),
    days: result.days.map((day) => ({
      date: day.date,
      weekday: weekdayName(day.date),
      status: day.status,
      ...(day.blockedBy.length > 0
        ? { blocked_by: day.blockedBy.map((entry) => presentNote(entry, timeZone)) }
        : {}),
    })),
  };
}

export type PresentedSlotResult = ReturnType<typeof presentSlotResult>;
