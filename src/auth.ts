import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedUser, readAccessConfig } from "@/lib/access";
import { CALENDAR_READ_SCOPE } from "@/lib/calendar/google";
import type { StoredGoogleTokens } from "@/lib/google/token";

const access = readAccessConfig(process.env);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          // Only a hint for the account chooser; the real check is in signIn below.
          ...(access.allowedDomain ? { hd: access.allowedDomain } : {}),
          scope: `openid email profile ${CALENDAR_READ_SCOPE}`,
          // Offline access plus consent make Google hand out a refresh token on every sign-in.
          access_type: "offline",
          prompt: "consent select_account",
        },
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  // Cloud Run terminates TLS in front of the container.
  trustHost: true,
  callbacks: {
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      return isAllowedUser(profile, access);
    },
    jwt({ token, account }) {
      if (account?.provider === "google") {
        // Kept in the encrypted session cookie only; never sent to the browser as data.
        const google: StoredGoogleTokens = {
          accessToken: account.access_token,
          expiresAt: account.expires_at,
          refreshToken: account.refresh_token,
          scope: account.scope,
        };
        token.google = google;
      }
      return token;
    },
  },
});
