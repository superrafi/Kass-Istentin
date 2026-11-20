import type { CalendarEvent } from "@/lib/calendar/types";
import {
  type Classification,
  classifyEvent,
  type MeetingMode,
  type OccupancyReason,
} from "@/lib/rules/classify";
import type { PersonRules } from "@/lib/rules/rules";
import {
  addDays,
  ceilToMinutes,
  daysBetween,
  isoWeekday,
  type LocalDate,
  type LocalTime,
  zonedTimeToUtc,
} from "@/lib/time/zoned";

const MINUTE = 60_000;
/** Proposals start on the quarter hour. */
const GRID_MINUTES = 15;
export const MAX_SEARCH_DAYS = 62;

export interface SlotRequest {
  /** First and last day to search, both included. */
  from: LocalDate;
  to: LocalDate;
  durationMinutes: number;
  /** How many proposals are wanted. */
  count: number;
  mode: MeetingMode;
  /** Narrows the person's usual day, e.g. "not before 9". */
  earliest?: LocalTime;
  latest?: LocalTime;
  avoidLunch?: boolean;
  /** Process the search belongs to; its own blockers are not conflicts. */
  processId?: string;
}

/** A calendar entry as it is mentioned in a finding. */
export interface EventNote {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  online: boolean;
  reason: OccupancyReason;
}

export interface SlotProposal {
  date: LocalDate;
  start: Date;
  end: Date;
  /** Last entry before the slot on the same day, with the gap to it. */
  before?: EventNote & { gapMinutes: number };
  /** First entry after the slot on the same day, with the gap to it. */
  after?: EventNote & { gapMinutes: number };
  /** Movable or tentative entries the slot overlaps. */
  overlaps: EventNote[];
}

export type DayStatus =
  /** At least one proposal lies on this day. */
  | "proposed"
  /** Free time exists, but enough proposals were found elsewhere. */
  | "available"
  /** Busy entries leave no gap that is long enough. */
  | "full"
  /** Home-office day and the meeting is on site. */
  | "homeOffice"
  | "notAWorkday"
  /** The day, or what is left of it, lies in the past. */
  | "past"
  /** The requested time window is shorter than the meeting. */
  | "windowTooShort";

export interface DayReport {
  date: LocalDate;
  status: DayStatus;
  /** Entries that block time inside the search window. */
  blockedBy: EventNote[];
}

export interface SlotSearchResult {
  proposals: SlotProposal[];
  days: DayReport[];
}

export interface Interval {
  start: number;
  end: number;
}

export interface Classified {
  event: CalendarEvent;
  classification: Classification;
}

interface Candidate {
  start: number;
  end: number;
  overlaps: Classified[];
}

interface DayPlan {
  date: LocalDate;
  status: DayStatus;
  blockedBy: Classified[];
  /** Entries of the day that can be named as surroundings. */
  timed: Classified[];
  candidates: Candidate[];
  chosen: Candidate[];
}

export function overlapsInterval(event: CalendarEvent, interval: Interval): boolean {
  return event.start.getTime() < interval.end && event.end.getTime() > interval.start;
}

export function note({ event, classification }: Classified): EventNote {
  return {
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    ...(event.location ? { location: event.location } : {}),
    online: !event.location && event.hasVideoLink,
    reason: classification.reason,
  };
}

/** Removes the blocked intervals from the window and returns what is left. */
function subtract(window: Interval, blocked: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const block of [...blocked].sort((a, b) => a.start - b.start)) {
    if (block.end <= cursor) continue;
    if (block.start >= window.end) break;
    if (block.start > cursor) free.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

function laterTime(a: LocalTime, b: LocalTime | undefined): LocalTime {
  return b && b > a ? b : a;
}

function earlierTime(a: LocalTime, b: LocalTime | undefined): LocalTime {
  return b && b < a ? b : a;
}

function planDay(
  date: LocalDate,
  request: SlotRequest,
  classified: Classified[],
  rules: PersonRules,
  now: Date,
): DayPlan {
  const plan: DayPlan = {
    date,
    status: "full",
    blockedBy: [],
    timed: [],
    candidates: [],
    chosen: [],
  };
  const duration = request.durationMinutes * MINUTE;
  const at = (time: LocalTime) => zonedTimeToUtc(date, time, rules.timeZone).getTime();

  if (!rules.workdays.includes(isoWeekday(date))) {
    plan.status = "notAWorkday";
    return plan;
  }

  const window: Interval = {
    start: at(laterTime(rules.dayStart, request.earliest)),
    end: at(earlierTime(rules.dayEnd, request.latest)),
  };
  if (window.end - window.start < duration) {
    plan.status = "windowTooShort";
    return plan;
  }
  const earliestStart = ceilToMinutes(now, GRID_MINUTES).getTime();
  if (window.end - Math.max(window.start, earliestStart) < duration) {
    plan.status = "past";
    return plan;
  }
  window.start = Math.max(window.start, earliestStart);

  const day: Interval = { start: at("00:00"), end: zonedTimeToUtc(addDays(date, 1), "00:00", rules.timeZone).getTime() };
  const today = classified.filter(({ event }) => overlapsInterval(event, day));
  plan.timed = today
    .filter(({ event, classification }) => !event.allDay && classification.occupancy !== "free" && classification.occupancy !== "homeOffice")
    .sort((a, b) => a.event.start.getTime() - b.event.start.getTime());

  const blocking = today.filter(({ classification }) => {
    if (classification.occupancy === "busy") return true;
    return classification.occupancy === "homeOffice" && request.mode === "onsite";
  });
  const blocked: Interval[] = blocking.map(({ event }) => ({
    start: event.start.getTime(),
    end: event.end.getTime(),
  }));
  if (request.avoidLunch) {
    blocked.push({ start: at(rules.lunch.start), end: at(rules.lunch.end) });
  }
  plan.blockedBy = blocking.filter(({ event }) => overlapsInterval(event, window));

  const soft = today.filter(
    ({ classification }) =>
      classification.occupancy === "movable" || classification.occupancy === "soft",
  );
  for (const gap of subtract(window, blocked)) {
    for (
      let start = ceilToMinutes(new Date(gap.start), GRID_MINUTES).getTime();
      start + duration <= gap.end;
      start += GRID_MINUTES * MINUTE
    ) {
      const slot = { start, end: start + duration };
      plan.candidates.push({ ...slot, overlaps: soft.filter(({ event }) => overlapsInterval(event, slot)) });
    }
  }

  if (plan.candidates.length > 0) {
    plan.status = "available";
  } else if (
    blocking.some(({ event, classification }) =>
      classification.occupancy === "homeOffice" && event.start.getTime() <= window.start && event.end.getTime() >= window.end,
    )
  ) {
    plan.status = "homeOffice";
  }
  return plan;
}

/**
 * Picks proposals so that they are spread over the days: one per day in date
 * order, then a second one per day, and so on. Slots that overlap nothing are
 * used up first.
 */
function choose(plans: DayPlan[], count: number): void {
  let remaining = count;
  for (const allowOverlaps of [false, true]) {
    let progressed = true;
    while (remaining > 0 && progressed) {
      progressed = false;
      for (const plan of plans) {
        if (remaining === 0) break;
        const next = plan.candidates.find(
          (candidate) =>
            (allowOverlaps || candidate.overlaps.length === 0) &&
            plan.chosen.every((taken) => candidate.start >= taken.end || candidate.end <= taken.start),
        );
        if (!next) continue;
        plan.chosen.push(next);
        remaining -= 1;
        progressed = true;
      }
    }
  }
}

function describe(plan: DayPlan, candidate: Candidate): SlotProposal {
  const before = plan.timed.filter(({ event }) => event.end.getTime() <= candidate.start).at(-1);
  const after = plan.timed.find(({ event }) => event.start.getTime() >= candidate.end);
  return {
    date: plan.date,
    start: new Date(candidate.start),
    end: new Date(candidate.end),
    ...(before
      ? { before: { ...note(before), gapMinutes: (candidate.start - before.event.end.getTime()) / MINUTE } }
      : {}),
    ...(after
      ? { after: { ...note(after), gapMinutes: (after.event.start.getTime() - candidate.end) / MINUTE } }
      : {}),
    overlaps: candidate.overlaps.map(note),
  };
}

export function validateSlotRequest(request: SlotRequest): string | null {
  const span = daysBetween(request.from, request.to);
  if (span < 0) return "to must not be before from";
  if (span >= MAX_SEARCH_DAYS) return `search at most ${MAX_SEARCH_DAYS} days at once`;
  if (!Number.isInteger(request.durationMinutes) || request.durationMinutes < 5 || request.durationMinutes > 600) {
    return "durationMinutes must be between 5 and 600";
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 20) {
    return "count must be between 1 and 20";
  }
  return null;
}

/**
 * Finds free slots according to the person's rules. Pure code: the same
 * calendar and request always give the same answer.
 */
export function findSlots(
  request: SlotRequest,
  events: CalendarEvent[],
  rules: PersonRules,
  now: Date,
): SlotSearchResult {
  const problem = validateSlotRequest(request);
  if (problem) throw new RangeError(problem);

  const classified: Classified[] = events.map((event) => ({
    event,
    classification: classifyEvent(event, rules, { processId: request.processId }),
  }));
  const plans: DayPlan[] = [];
  for (let date = request.from; date <= request.to; date = addDays(date, 1)) {
    plans.push(planDay(date, request, classified, rules, now));
  }
  choose(plans, request.count);

  return {
    proposals: plans.flatMap((plan) =>
      [...plan.chosen].sort((a, b) => a.start - b.start).map((candidate) => describe(plan, candidate)),
    ),
    days: plans.map((plan) => ({
      date: plan.date,
      status: plan.chosen.length > 0 ? "proposed" : plan.status,
      blockedBy: plan.blockedBy.map(note),
    })),
  };
}
