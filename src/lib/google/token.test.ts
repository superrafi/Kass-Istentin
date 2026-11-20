import { describe, expect, it, vi } from "vitest";
import { CALENDAR_SCOPE } from "@/lib/calendar/google";
import { hasCalendarScope, refreshAccessToken, resolveAccessToken } from "./token";

const NOW = new Date("2026-11-23T08:00:00Z");
const nowSeconds = NOW.getTime() / 1000;
const scope = `openid email ${CALENDAR_SCOPE}`;
const noRefresh = vi.fn(async () => null);

describe("hasCalendarScope", () => {
  it("requires the calendar scope", () => {
    expect(hasCalendarScope({ scope })).toBe(true);
    expect(hasCalendarScope({ scope: "openid email" })).toBe(false);
    expect(hasCalendarScope(undefined)).toBe(false);
  });
});

describe("resolveAccessToken", () => {
  it("uses the stored token while it is valid", async () => {
    const result = await resolveAccessToken(
      { accessToken: "stored", expiresAt: nowSeconds + 600, scope },
      "user-a",
      NOW,
      noRefresh,
    );
    expect(result).toEqual({ ok: true, accessToken: "stored" });
    expect(noRefresh).not.toHaveBeenCalled();
  });

  it("refreshes an expired token once and reuses the result", async () => {
    const refresh = vi.fn(async () => ({ accessToken: "fresh", expiresAt: nowSeconds + 3600 }));
    const stored = { accessToken: "old", expiresAt: nowSeconds - 10, refreshToken: "r1", scope };

    expect(await resolveAccessToken(stored, "user-b", NOW, refresh)).toEqual({ ok: true, accessToken: "fresh" });
    expect(await resolveAccessToken(stored, "user-b", NOW, refresh)).toEqual({ ok: true, accessToken: "fresh" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("r1");
  });

  it("refreshes shortly before the token expires", async () => {
    const refresh = vi.fn(async () => ({ accessToken: "fresh", expiresAt: nowSeconds + 3600 }));
    await resolveAccessToken(
      { accessToken: "old", expiresAt: nowSeconds + 30, refreshToken: "r1", scope },
      "user-c",
      NOW,
      refresh,
    );
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["no stored credentials", undefined],
    ["a sign-in without calendar scope", { accessToken: "a", expiresAt: nowSeconds + 600, scope: "openid" }],
    ["an expired token without refresh token", { accessToken: "a", expiresAt: nowSeconds - 10, scope }],
  ])("reports %s as not connected", async (_name, stored) => {
    expect(await resolveAccessToken(stored, "user-d", NOW, noRefresh)).toEqual({
      ok: false,
      problem: "notConnected",
    });
  });

  it("reports a failed refresh as not connected", async () => {
    const stored = { accessToken: "old", expiresAt: nowSeconds - 10, refreshToken: "revoked", scope };
    expect(await resolveAccessToken(stored, "user-e", NOW, noRefresh)).toEqual({
      ok: false,
      problem: "notConnected",
    });
  });
});

describe("refreshAccessToken", () => {
  const credentials = { clientId: "client", clientSecret: "secret" };

  it("exchanges the refresh token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ access_token: "fresh", expires_in: 1800 }));
    const result = await refreshAccessToken("r1", credentials, NOW, fetchImpl);

    expect(result).toEqual({ accessToken: "fresh", expiresAt: nowSeconds + 1800 });
    const body = fetchImpl.mock.calls[0]![1]!.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "r1",
      client_id: "client",
      client_secret: "secret",
    });
  });

  it("returns null when Google rejects the token or is unreachable", async () => {
    const rejected = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
    expect(await refreshAccessToken("r1", credentials, NOW, rejected)).toBeNull();
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));
    expect(await refreshAccessToken("r1", credentials, NOW, offline)).toBeNull();
  });
});
