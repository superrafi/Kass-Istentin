import { createHmac, timingSafeEqual } from "node:crypto";
import type { Proposal, SignedProposal } from "./types";

/** How long a proposal can be confirmed. */
export const PROPOSAL_TTL_SECONDS = 30 * 60;

interface TokenPayload {
  proposal: Proposal;
  /** The person the proposal was made for. */
  email: string;
  /** Seconds since the epoch. */
  exp: number;
}

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", `kass-istentin-proposal:${secret}`).update(body).digest();
}

/**
 * Signs a proposal. Only a signed proposal can be executed, so the calendar
 * is written exactly as the code proposed it and the person saw it.
 */
export function signProposal(proposal: Proposal, email: string, secret: string, now: Date): SignedProposal {
  const payload: TokenPayload = {
    proposal,
    email: email.toLowerCase(),
    exp: Math.floor(now.getTime() / 1000) + PROPOSAL_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { proposal, token: `${body}.${mac(body, secret).toString("base64url")}` };
}

export type VerifyResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; problem: "invalid" | "expired" | "wrongPerson" };

export function verifyProposal(token: unknown, email: string, secret: string, now: Date): VerifyResult {
  if (typeof token !== "string") return { ok: false, problem: "invalid" };
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return { ok: false, problem: "invalid" };

  const given = Buffer.from(signature, "base64url");
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, problem: "invalid" };
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  if (payload.email !== email.toLowerCase()) return { ok: false, problem: "wrongPerson" };
  if (payload.exp <= now.getTime() / 1000) return { ok: false, problem: "expired" };
  return { ok: true, proposal: payload.proposal };
}
