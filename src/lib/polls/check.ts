import type { CalendarEvent } from "@/lib/calendar/types";
import { classifyEvent, type MeetingMode } from "@/lib/rules/classify";
import type { PersonRules } from "@/lib/rules/rules";
import { type Classified, type EventNote, note, overlapsInterval } from "@/lib/slots/search";
import {
  isLocalDate,
  isLocalTime,
  isoWeekday,
  type LocalDate,
  type LocalTime,
  zonedTimeToUtc,
} from "@/lib/time/zoned";

const MINUTE = 60_000;
export const MAX_POLL_SLOTS = 30;

/** One option of a scheduling poll, in the person's local time. */
export interface PollSlot {
  date: LocalDate;
  start: LocalTime;
  end: LocalTime;
}

export type FindingStatus = "free" | "busy" | "uncertain";

export type FindingReason =
  /** Overlaps an entry that blocks the time. */
  | "conflict"
  /** On-site meeting during home office. */
  | "homeOffice"
  | "past"
  /** Overlaps an entry that may be moved, e.g. a standup. */
  | "movable"
  /** Overlaps a tentative, optional entry. */
  | "tentative"
  /** An entry at another place lies shortly before or after. */
  | "placeBefore"
  | "placeAfter"
  | "outsideHours"
  | "notAWorkday";

export interface SlotFinding {
  slot: PollSlot;
  start: Date;
  end: Date;
  status: FindingStatus;
  reasons: { code: FindingReason; event?: EventNote }[];
  /** A blocker of the same process already covers exactly this slot. */
  alreadyBlocked: boolean;
}

export interface CheckContext {
  mode: MeetingMode;
  /** Process the poll belongs to; its own blockers are not conflicts. */
  processId?: string;
}

const BUSY_REASONS: FindingReason[] = ["conflict", "homeOffice", "past"];

export function validatePollSlots(slots: PollSlot[]): string | null {
  if (slots.length === 0) return "at least one slot is needed";
  if (slots.length > MAX_POLL_SLOTS) return `at most ${MAX_POLL_SLOTS} slots at once`;
  for (const slot of slots) {
    if (!isLocalDate(slot.date)) return "dates must be in the form YYYY-MM-DD";
    if (!isLocalTime(slot.start) || !isLocalTime(slot.end)) return "times must be in the form HH:MM";
    if (slot.end <= slot.start) return "a slot must end after it starts, on the same day";
  }
  return null;
}

/** The period that has to be loaded to judge the slots: their days, start to end. */
export function pollPeriod(slots: PollSlot[], timeZone: string): { start: Date; end: Date } {
  const dates = slots.map((slot) => slot.date).sort();
  return {
    start: zonedTimeToUtc(dates[0]!, "00:00", timeZone),
    end: zonedTimeToUtc(dates.at(-1)!, "23:59", timeZone),
  };
}

/**
 * Checks each poll slot against the calendar, including what lies around it.
 * Pure code: gives a finding of free, busy or uncertain with the reasons.
 */
export function checkSlots(
  slots: PollSlot[],
  events: CalendarEvent[],
  rules: PersonRules,
  now: Date,
  context: CheckContext,
): SlotFinding[] {
  const problem = validatePollSlots(slots);
  if (problem) throw new RangeError(problem);

  const classified: Classified[] = events.map((event) => ({
    event,
    classification: classifyEvent(event, rules, { processId: context.processId }),
  }));
  const warning = rules.travelWarningMinutes * MINUTE;

  return slots.map((slot) => {
    const start = zonedTimeToUtc(slot.date, slot.start, rules.timeZone);
    const end = zonedTimeToUtc(slot.date, slot.end, rules.timeZone);
    const interval = { start: start.getTime(), end: end.getTime() };
    const reasons: SlotFinding["reasons"] = [];

    if (interval.start < now.getTime()) reasons.push({ code: "past" });
    if (!rules.workdays.includes(isoWeekday(slot.date))) reasons.push({ code: "notAWorkday" });
    else if (slot.start < rules.dayStart || slot.end > rules.dayEnd) reasons.push({ code: "outsideHours" });

    for (const entry of classified) {
      if (!overlapsInterval(entry.event, interval)) continue;
      const { occupancy } = entry.classification;
      if (occupancy === "busy") reasons.push({ code: "conflict", event: note(entry) });
      if (occupancy === "homeOffice" && context.mode === "onsite") {
        reasons.push({ code: "homeOffice", event: note(entry) });
      }
      if (occupancy === "movable") reasons.push({ code: "movable", event: note(entry) });
      if (occupancy === "soft") reasons.push({ code: "tentative", event: note(entry) });
    }

    // Entries at a place right before or after: travel may not fit.
    const elsewhere = classified.filter(
      ({ event, classification }) =>
        !event.allDay &&
        Boolean(event.location) &&
        (classification.occupancy === "busy" || classification.occupancy === "soft"),
    );
    const before = elsewhere
      .filter(({ event }) => event.end.getTime() <= interval.start && interval.start - event.end.getTime() < warning)
      .at(-1);
    const after = elsewhere.find(
      ({ event }) => event.start.getTime() >= interval.end && event.start.getTime() - interval.end < warning,
    );
    if (before) reasons.push({ code: "placeBefore", event: note(before) });
    if (after) reasons.push({ code: "placeAfter", event: note(after) });

    const alreadyBlocked =
      context.processId !== undefined &&
      events.some(
        (event) =>
          event.processId === context.processId &&
          !event.cancelled &&
          event.start.getTime() === interval.start &&
          event.end.getTime() === interval.end,
      );

    return {
      slot,
      start,
      end,
      status: reasons.some((reason) => BUSY_REASONS.includes(reason.code))
        ? "busy"
        : reasons.length > 0
          ? "uncertain"
          : "free",
      reasons,
      alreadyBlocked,
    };
  });
}
