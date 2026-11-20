import type { LocalTime } from "@/lib/time/zoned";

/**
 * Rules of one person. The defaults are the starting values from
 * docs/regeln.md; later they are stored per person and editable.
 */
export interface PersonRules {
  timeZone: string;
  /** ISO weekdays on which meetings may be proposed (1 = Monday). */
  workdays: number[];
  dayStart: LocalTime;
  dayEnd: LocalTime;
  lunch: { start: LocalTime; end: LocalTime };
  /** Title parts that make an entry busy even if it looks uncertain. */
  busyKeywords: string[];
  /** Title parts of entries that a meeting may overlap. */
  movableKeywords: string[];
  /** Title parts of home-office entries. */
  homeOfficeKeywords: string[];
}

export const DEFAULT_RULES: PersonRules = {
  timeZone: "Europe/Zurich",
  workdays: [1, 2, 3, 4, 5],
  dayStart: "08:00",
  dayEnd: "18:00",
  lunch: { start: "12:00", end: "13:00" },
  busyKeywords: ["Evt.", "Blocker", "Reserve"],
  movableKeywords: ["Standup"],
  homeOfficeKeywords: ["Homeoffice", "@Home"],
};
