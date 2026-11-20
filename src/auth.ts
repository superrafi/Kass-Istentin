import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedUser, readAccessConfig } from "@/lib/access";

const access = readAccessConfig(process.env);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          // Only a hint for the account chooser; the real check is in signIn below.
          ...(access.allowedDomain ? { hd: access.allowedDomain } : {}),
          prompt: "select_account",
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
  },
});
