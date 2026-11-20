import { zonedTimeToUtc } from "@/lib/time/zoned";
import type { CalendarEvent } from "./types";

export const CALENDAR_READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
/** Private extended property that links a blocker to its coordination process. */
export const PROCESS_PROPERTY = "kassVorgang";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
// Only what the rules need. The description is read for video links and then dropped.
const FIELDS =
  "nextPageToken,items(id,status,summary,description,location,start,end,transparency,eventType," +
  "hangoutLink,conferenceData(entryPoints(entryPointType)),attendees(self,responseStatus,optional)," +
  "extendedProperties(private),workingLocationProperties(type))";
const MAX_PAGES = 10;
const VIDEO_LINK =
  /https?:\/\/[^\s"'<>]*(teams\.microsoft\.com|teams\.live\.com|zoom\.us|meet\.google\.com|webex\.com|whereby\.com)/i;

export type CalendarProblem =
  /** The sign-in does not include calendar access, or it has expired. */
  | "notConnected"
  /** The Calendar API is switched off in the cloud project. */
  | "apiDisabled"
  | "unavailable";

export class CalendarAccessError extends Error {
  constructor(readonly problem: CalendarProblem) {
    super(`calendar access failed: ${problem}`);
    this.name = "CalendarAccessError";
  }
}

/** Shape of a Google Calendar event, limited to the requested fields. */
export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  transparency?: string;
  eventType?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string }[] };
  attendees?: { self?: boolean; responseStatus?: string; optional?: boolean }[];
  extendedProperties?: { private?: Record<string, string> };
  workingLocationProperties?: { type?: string };
}

function instant(
  point: { date?: string; dateTime?: string } | undefined,
  timeZone: string,
): Date | null {
  if (point?.dateTime) {
    const parsed = new Date(point.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  // All-day entries carry dates; they run from local midnight to local midnight.
  if (point?.date) return zonedTimeToUtc(point.date, "00:00", timeZone);
  return null;
}

const RESPONSES = ["accepted", "tentative", "declined", "needsAction"] as const;
const KINDS = ["outOfOffice", "focusTime", "workingLocation"] as const;

/** Reduces a Google event to what the rules need. Returns null for unusable entries. */
export function normalizeEvent(raw: GoogleEvent, timeZone: string): CalendarEvent | null {
  const start = instant(raw.start, timeZone);
  const end = instant(raw.end, timeZone);
  if (!raw.id || !start || !end || end <= start) return null;

  const me = raw.attendees?.find((attendee) => attendee.self);
  const hasVideoLink =
    Boolean(raw.hangoutLink) ||
    Boolean(raw.conferenceData?.entryPoints?.some((entry) => entry.entryPointType === "video")) ||
    VIDEO_LINK.test(raw.location ?? "") ||
    VIDEO_LINK.test(raw.description ?? "");
  const location = raw.location?.trim();
  const processId = raw.extendedProperties?.private?.[PROCESS_PROPERTY];

  return {
    id: raw.id,
    title: raw.summary?.trim() || "(ohne Titel)",
    start,
    end,
    allDay: Boolean(raw.start?.date),
    // A location that is only a meeting link is not a place.
    ...(location && !/^https?:\/\/\S+$/i.test(location) ? { location } : {}),
    hasVideoLink,
    transparent: raw.transparency === "transparent",
    cancelled: raw.status === "cancelled",
    myResponse: RESPONSES.find((response) => response === me?.responseStatus) ?? "none",
    optionalForMe: me?.optional === true,
    kind: KINDS.find((kind) => kind === raw.eventType) ?? "default",
    homeOffice: raw.workingLocationProperties?.type === "homeOffice",
    ...(processId ? { processId } : {}),
  };
}

async function problemOf(response: Response): Promise<CalendarProblem> {
  if (response.status === 401) return "notConnected";
  if (response.status === 403) {
    const body = await response.text().catch(() => "");
    if (/accessNotConfigured|SERVICE_DISABLED/.test(body)) return "apiDisabled";
    return "notConnected";
  }
  return "unavailable";
}

/** Loads all entries of the primary calendar that touch the given period. */
export async function listEvents(
  accessToken: string,
  period: { start: Date; end: Date },
  timeZone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(EVENTS_URL);
    url.searchParams.set("timeMin", period.start.toISOString());
    url.searchParams.set("timeMax", period.end.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("fields", FIELDS);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new CalendarAccessError("unavailable");
    }
    if (!response.ok) throw new CalendarAccessError(await problemOf(response));

    const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    for (const item of body.items ?? []) {
      const event = normalizeEvent(item, timeZone);
      if (event) events.push(event);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) return events;
  }
  // Better no answer than one based on half a calendar.
  throw new CalendarAccessError("unavailable");
}
