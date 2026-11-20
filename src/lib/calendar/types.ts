/** A calendar entry reduced to what the rules need. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  /** Exclusive end. */
  end: Date;
  allDay: boolean;
  location?: string;
  hasVideoLink: boolean;
  /** Marked as "free" in the calendar. */
  transparent: boolean;
  cancelled: boolean;
  /** The person's own answer; "none" for entries without guests. */
  myResponse: "accepted" | "tentative" | "declined" | "needsAction" | "none";
  /** The person is invited as an optional guest. */
  optionalForMe: boolean;
  kind: "default" | "outOfOffice" | "focusTime" | "workingLocation";
  /** For working-location entries: the location is the home office. */
  homeOffice: boolean;
  /** Id of the coordination process this entry was created for, if any. */
  processId?: string;
}
