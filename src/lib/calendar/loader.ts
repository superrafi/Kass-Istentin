import { type CookieSource, getGoogleAccessToken } from "@/lib/google/token";
import type { CalendarWriter } from "@/lib/proposals/execute";
import type { EventLoader } from "@/lib/slots/service";
import { CalendarAccessError, deleteEvent, getEvent, insertBlocker, listEvents } from "./google";

async function accessToken(request: CookieSource): Promise<string> {
  const token = await getGoogleAccessToken(request);
  if (!token.ok) throw new CalendarAccessError("notConnected");
  return token.accessToken;
}

/** Event loader for the person whose session cookie is on the request. */
export function eventLoaderFor(request: CookieSource, timeZone: string): EventLoader {
  return async (period) => listEvents(await accessToken(request), period, timeZone);
}

/** Calendar access for executing a proposal the person has confirmed. */
export function calendarWriterFor(request: CookieSource, timeZone: string): CalendarWriter {
  return {
    list: async (period) => listEvents(await accessToken(request), period, timeZone),
    insert: async (blocker) => insertBlocker(await accessToken(request), blocker),
    get: async (eventId) => getEvent(await accessToken(request), eventId, timeZone),
    remove: async (eventId) => deleteEvent(await accessToken(request), eventId),
  };
}
