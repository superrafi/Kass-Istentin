import { describe, expect, it } from "vitest";
import { isAllowedUser, readAccessConfig } from "./access";

const config = readAccessConfig({ ALLOWED_GOOGLE_DOMAIN: "Example.com" });
const member = { email: "mira@example.com", email_verified: true, hd: "example.com" };

describe("readAccessConfig", () => {
  it("normalises domain and address list", () => {
    expect(
      readAccessConfig({
        ALLOWED_GOOGLE_DOMAIN: " Example.com ",
        ALLOWED_EMAILS: "Mira@Example.com, ,jon@example.com",
      }),
    ).toEqual({
      allowedDomain: "example.com",
      allowedEmails: ["mira@example.com", "jon@example.com"],
    });
  });

  it("treats empty settings as unset", () => {
    expect(readAccessConfig({ ALLOWED_GOOGLE_DOMAIN: "" })).toEqual({
      allowedDomain: undefined,
      allowedEmails: [],
    });
  });
});

describe("isAllowedUser", () => {
  it("allows a verified member of the domain", () => {
    expect(isAllowedUser(member, config)).toBe(true);
  });

  it("denies everyone when no domain is configured", () => {
    expect(isAllowedUser(member, readAccessConfig({}))).toBe(false);
  });

  it("denies a missing identity", () => {
    expect(isAllowedUser(undefined, config)).toBe(false);
  });

  it("denies an unverified address", () => {
    expect(isAllowedUser({ ...member, email_verified: false }, config)).toBe(false);
  });

  it("denies another Workspace domain", () => {
    expect(
      isAllowedUser(
        { email: "mira@other.example", email_verified: true, hd: "other.example" },
        config,
      ),
    ).toBe(false);
  });

  it("denies a private account without hd claim", () => {
    expect(isAllowedUser({ ...member, hd: undefined }, config)).toBe(false);
  });

  it("denies a matching hd claim with a foreign address", () => {
    expect(isAllowedUser({ ...member, email: "mira@other.example" }, config)).toBe(false);
  });

  it("restricts to the address list when one is set", () => {
    const restricted = readAccessConfig({
      ALLOWED_GOOGLE_DOMAIN: "example.com",
      ALLOWED_EMAILS: "mira@example.com",
    });
    expect(isAllowedUser({ ...member, email: "Mira@Example.com" }, restricted)).toBe(true);
    expect(isAllowedUser({ ...member, email: "jon@example.com" }, restricted)).toBe(false);
  });
});
