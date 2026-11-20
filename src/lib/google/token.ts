import { getToken } from "next-auth/jwt";
import { CALENDAR_READ_SCOPE } from "@/lib/calendar/google";

/** Google credentials as they are kept in the encrypted session cookie. */
export interface StoredGoogleTokens {
  accessToken?: string;
  /** Seconds since the epoch. */
  expiresAt?: number;
  refreshToken?: string;
  scope?: string;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; problem: "signedOut" | "notConnected" };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Refresh a little early so a token does not expire mid-request. */
const EXPIRY_MARGIN_SECONDS = 60;
const refreshed = new Map<string, { accessToken: string; expiresAt: number }>();

export function hasCalendarScope(tokens: StoredGoogleTokens | undefined): boolean {
  return Boolean(tokens?.scope?.split(" ").includes(CALENDAR_READ_SCOPE));
}

function isFresh(expiresAt: number | undefined, now: Date): boolean {
  return expiresAt !== undefined && expiresAt - EXPIRY_MARGIN_SECONDS > now.getTime() / 1000;
}

export async function refreshAccessToken(
  refreshToken: string,
  credentials: { clientId: string; clientSecret: string },
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number } | null> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  return {
    accessToken: body.access_token,
    expiresAt: Math.floor(now.getTime() / 1000) + (body.expires_in ?? 3600),
  };
}

/**
 * Returns a valid access token for the stored credentials, refreshing it when
 * needed. `cacheKey` identifies the person, so a refreshed token is reused
 * until it expires.
 */
export async function resolveAccessToken(
  tokens: StoredGoogleTokens | undefined,
  cacheKey: string,
  now: Date,
  refresh: (refreshToken: string) => Promise<{ accessToken: string; expiresAt: number } | null>,
): Promise<AccessTokenResult> {
  if (!tokens || !hasCalendarScope(tokens)) return { ok: false, problem: "notConnected" };
  if (tokens.accessToken && isFresh(tokens.expiresAt, now)) {
    return { ok: true, accessToken: tokens.accessToken };
  }
  const cached = refreshed.get(cacheKey);
  if (cached && isFresh(cached.expiresAt, now)) {
    return { ok: true, accessToken: cached.accessToken };
  }
  if (!tokens.refreshToken) return { ok: false, problem: "notConnected" };
  const renewed = await refresh(tokens.refreshToken);
  if (!renewed) return { ok: false, problem: "notConnected" };
  refreshed.set(cacheKey, renewed);
  return { ok: true, accessToken: renewed.accessToken };
}

/** Reads the session cookie of the request and returns a Google access token. */
export async function getGoogleAccessToken(request: Request): Promise<AccessTokenResult> {
  const secret = process.env.AUTH_SECRET;
  // The cookie name depends on whether the app is served over HTTPS.
  const session =
    (await getToken({ req: request, secret, secureCookie: true })) ??
    (await getToken({ req: request, secret, secureCookie: false }));
  if (!session?.sub) return { ok: false, problem: "signedOut" };

  const now = new Date();
  return resolveAccessToken(
    session.google as StoredGoogleTokens | undefined,
    session.sub,
    now,
    (refreshToken) =>
      refreshAccessToken(
        refreshToken,
        {
          clientId: process.env.AUTH_GOOGLE_ID ?? "",
          clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
        },
        now,
      ),
  );
}
