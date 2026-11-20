import { CalendarAccessError } from "@/lib/calendar/google";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { PersonRules } from "@/lib/rules/rules";
import { addDays, isLocalDate, isLocalTime, zonedTimeToUtc } from "@/lib/time/zoned";
import { type PresentedSlotResult, presentSlotResult } from "./present";
import { findSlots, type SlotRequest, validateSlotRequest } from "./search";

/** Loads the calendar entries that touch the given period. */
export type EventLoader = (period: { start: Date; end: Date }) => Promise<CalendarEvent[]>;

export type SlotSearchOutcome =
  | { ok: true; result: PresentedSlotResult }
  | { ok: false; error: "invalidRequest"; detail: string }
  | { ok: false; error: "calendar"; problem: CalendarAccessError["problem"] };

export function checkSlotRequest(request: SlotRequest): string | null {
  if (!isLocalDate(request.from) || !isLocalDate(request.to)) {
    return "from and to must be dates in the form YYYY-MM-DD";
  }
  for (const time of [request.earliest, request.latest]) {
    if (time !== undefined && !isLocalTime(time)) return "times must be in the form HH:MM";
  }
  return validateSlotRequest(request);
}

/** Checks the request, loads the calendar for the period and runs the search. */
export async function searchSlots(
  request: SlotRequest,
  loadEvents: EventLoader,
  rules: PersonRules,
  now: Date,
): Promise<SlotSearchOutcome> {
  const problem = checkSlotRequest(request);
  if (problem) return { ok: false, error: "invalidRequest", detail: problem };

  let events: CalendarEvent[];
  try {
    events = await loadEvents({
      start: zonedTimeToUtc(request.from, "00:00", rules.timeZone),
      end: zonedTimeToUtc(addDays(request.to, 1), "00:00", rules.timeZone),
    });
  } catch (error) {
    if (error instanceof CalendarAccessError) {
      return { ok: false, error: "calendar", problem: error.problem };
    }
    throw error;
  }
  return { ok: true, result: presentSlotResult(findSlots(request, events, rules, now), rules.timeZone) };
}
