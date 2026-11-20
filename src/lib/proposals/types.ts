import type { FindingStatus } from "@/lib/polls/check";

/** A time span as it is shown to the person and as it is written. */
export interface ProposalSpan {
  /** ISO instants; these are what gets written. */
  start: string;
  end: string;
  /** Local wording, e.g. "Montag, 23.11.2026, 10:00–11:00". */
  label: string;
}

/** Blockers the assistant wants to create. Nothing is written before the person confirms. */
export interface CreateBlockersProposal {
  kind: "createBlockers";
  processId: string;
  processTitle: string;
  /** Title the blockers get in the calendar. */
  eventTitle: string;
  entries: (ProposalSpan & { status: FindingStatus; notes: string[] })[];
}

/** Blockers the assistant wants to delete. Nothing is deleted before the person confirms. */
export interface DeleteBlockersProposal {
  kind: "deleteBlockers";
  processTitle: string;
  entries: (ProposalSpan & { eventId: string; title: string })[];
  /** Blockers of the process that stay, e.g. the confirmed slot. */
  kept: ProposalSpan[];
}

export type Proposal = CreateBlockersProposal | DeleteBlockersProposal;

/** A proposal with a token that proves the app made it for this person. */
export interface SignedProposal {
  proposal: Proposal;
  token: string;
}

export type EntryOutcome =
  | "created"
  /** A blocker of this process already covers the slot. */
  | "exists"
  | "deleted"
  /** The entry was already gone. */
  | "gone"
  /** The entry is not a blocker (any more) or was moved; it was left alone. */
  | "refused"
  | "failed";

export interface ExecutionResult {
  kind: Proposal["kind"];
  entries: { label: string; outcome: EntryOutcome }[];
}
