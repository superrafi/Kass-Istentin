import type { CalendarEvent } from "@/lib/calendar/types";
import type { PersonRules } from "./rules";

/** Whether the meeting to be scheduled is a call or takes place on site. */
export type MeetingMode = "online" | "onsite";

export type Occupancy =
  /** Blocks the time. */
  | "busy"
  /** May be overlapped, e.g. a standup. */
  | "movable"
  /** Not hard busy, but worth mentioning. */
  | "soft"
  /** Home-office marker: calls are fine, on-site meetings are not. */
  | "homeOffice"
  /** Does not affect the search. */
  | "free";

export type OccupancyReason =
  | "cancelled"
  | "declined"
  | "ownBlocker"
  | "busyKeyword"
  | "homeOffice"
  | "workingLocation"
  | "movableKeyword"
  | "markedFree"
  | "outOfOffice"
  | "tentativeOptional"
  | "regular";

export interface Classification {
  occupancy: Occupancy;
  reason: OccupancyReason;
}

export interface ClassifyContext {
  /** Process the search belongs to; its own blockers are not conflicts. */
  processId?: string;
}

function titleHas(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

/** Applies the rules from docs/regeln.md, "Wann ist eine Zeit besetzt?". */
export function classifyEvent(
  event: CalendarEvent,
  rules: PersonRules,
  context: ClassifyContext = {},
): Classification {
  if (event.cancelled) return { occupancy: "free", reason: "cancelled" };
  if (event.myResponse === "declined") return { occupancy: "free", reason: "declined" };
  if (context.processId && event.processId === context.processId) {
    return { occupancy: "free", reason: "ownBlocker" };
  }
  // Keywords win over everything below: "Evt." entries are often marked free or tentative.
  if (titleHas(event.title, rules.busyKeywords)) {
    return { occupancy: "busy", reason: "busyKeyword" };
  }
  if (event.homeOffice || titleHas(event.title, rules.homeOfficeKeywords)) {
    return { occupancy: "homeOffice", reason: "homeOffice" };
  }
  if (event.kind === "workingLocation") {
    return { occupancy: "free", reason: "workingLocation" };
  }
  if (titleHas(event.title, rules.movableKeywords)) {
    return { occupancy: "movable", reason: "movableKeyword" };
  }
  if (event.kind === "outOfOffice") return { occupancy: "busy", reason: "outOfOffice" };
  if (event.transparent) return { occupancy: "free", reason: "markedFree" };
  if (event.myResponse === "tentative" && event.optionalForMe) {
    return { occupancy: "soft", reason: "tentativeOptional" };
  }
  return { occupancy: "busy", reason: "regular" };
}
