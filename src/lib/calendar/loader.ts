import { getGoogleAccessToken } from "@/lib/google/token";
import type { EventLoader } from "@/lib/slots/service";
import { CalendarAccessError, listEvents } from "./google";

/** Event loader for the person whose session cookie is on the request. */
export function eventLoaderFor(request: Request, timeZone: string): EventLoader {
  return async (period) => {
    const token = await getGoogleAccessToken(request);
    if (!token.ok) throw new CalendarAccessError("notConnected");
    return listEvents(token.accessToken, period, timeZone);
  };
}
