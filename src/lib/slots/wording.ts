import type { OccupancyReason } from "@/lib/rules/classify";
import type { DayStatus } from "./search";

/** German wording for the findings of the slot search, for pages people read. */
export const DAY_STATUS_TEXT: Record<DayStatus, string> = {
  proposed: "Vorschlag",
  available: "frei, nicht gebraucht",
  full: "nichts frei",
  homeOffice: "Homeoffice, kein Termin vor Ort",
  notAWorkday: "kein Arbeitstag",
  past: "vorbei",
  windowTooShort: "Zeitfenster zu kurz",
};

export const OCCUPANCY_REASON_TEXT: Record<OccupancyReason, string> = {
  cancelled: "abgesagt",
  declined: "abgelehnt",
  ownBlocker: "eigener Blocker",
  busyKeyword: "besetzt wegen Stichwort im Titel",
  homeOffice: "Homeoffice",
  workingLocation: "Arbeitsort",
  movableKeyword: "verschiebbar",
  markedFree: "als frei markiert",
  outOfOffice: "Abwesenheit",
  tentativeOptional: "vorläufig zugesagt, freiwillig",
  regular: "Termin",
};

export const CALENDAR_PROBLEM_TEXT = {
  notConnected: "Kein Zugriff auf den Kalender. Melde Dich ab und neu an und erlaube den Kalenderzugriff.",
  apiDisabled: "Die Google Calendar API ist im Cloud-Projekt nicht eingeschaltet.",
  unavailable: "Der Kalender ist gerade nicht erreichbar. Versuch es nochmals.",
} as const;
