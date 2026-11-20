import { describe, expect, it } from "vitest";
import { PROPOSAL_TTL_SECONDS, signProposal, verifyProposal } from "./sign";
import type { Proposal } from "./types";

const NOW = new Date("2026-11-20T10:00:00Z");
const SECRET = "test-secret";
const proposal: Proposal = {
  kind: "createBlockers",
  processId: "p1",
  processTitle: "Retraite",
  eventTitle: "Blocker Retraite",
  entries: [
    {
      start: "2026-11-23T09:00:00.000Z",
      end: "2026-11-23T10:00:00.000Z",
      label: "Montag, 23.11.2026, 10:00–11:00",
      status: "free",
      notes: [],
    },
  ],
};
const signed = signProposal(proposal, "Mira@Example.com", SECRET, NOW);

describe("proposal signature", () => {
  it("accepts a proposal the app signed for this person", () => {
    expect(verifyProposal(signed.token, "mira@example.com", SECRET, NOW)).toEqual({ ok: true, proposal });
  });

  it("rejects a changed proposal", () => {
    const [body, signature] = signed.token.split(".");
    const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    payload.proposal.entries[0].start = "2026-11-24T09:00:00.000Z";
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
    expect(verifyProposal(forged, "mira@example.com", SECRET, NOW)).toEqual({ ok: false, problem: "invalid" });
  });

  it("rejects a token signed with another secret", () => {
    const other = signProposal(proposal, "mira@example.com", "other-secret", NOW);
    expect(verifyProposal(other.token, "mira@example.com", SECRET, NOW).ok).toBe(false);
  });

  it("rejects another person's proposal", () => {
    expect(verifyProposal(signed.token, "jon@example.com", SECRET, NOW)).toEqual({
      ok: false,
      problem: "wrongPerson",
    });
  });

  it("rejects an expired proposal", () => {
    const later = new Date(NOW.getTime() + PROPOSAL_TTL_SECONDS * 1000);
    expect(verifyProposal(signed.token, "mira@example.com", SECRET, later)).toEqual({
      ok: false,
      problem: "expired",
    });
  });

  it.each([undefined, 42, "", "abc", "a.b.c", "!!.??"])("rejects the malformed token %j", (token) => {
    expect(verifyProposal(token, "mira@example.com", SECRET, NOW)).toEqual({ ok: false, problem: "invalid" });
  });
});
