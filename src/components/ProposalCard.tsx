"use client";

import type { EntryOutcome, ExecutionResult, SignedProposal } from "@/lib/proposals/types";

export type ProposalState =
  | { step: "open" }
  | { step: "working" }
  | { step: "declined" }
  | { step: "done"; result: ExecutionResult }
  | { step: "error"; message: string };

const OUTCOME_TEXT: Record<EntryOutcome, string> = {
  created: "eingetragen",
  exists: "war schon eingetragen",
  deleted: "gelöscht",
  gone: "war schon gelöscht",
  refused: "nicht gelöscht: Der Eintrag wurde geändert oder ist kein Blocker mehr",
  failed: "fehlgeschlagen",
};

const STATUS_TEXT = { free: "frei", uncertain: "unsicher", busy: "besetzt" } as const;

/** One sentence about what happened, for the chat history the model sees. */
export function proposalNote(signed: SignedProposal, state: ProposalState): string | null {
  const { proposal } = signed;
  const what =
    proposal.kind === "createBlockers"
      ? `Vorschlag «${proposal.eventTitle}» eintragen (Vorgang ${proposal.processId})`
      : `Vorschlag Blocker «${proposal.processTitle}» löschen`;
  if (state.step === "declined") return `[${what}: von der Person abgelehnt, nichts geändert.]`;
  if (state.step === "error") return `[${what}: fehlgeschlagen. ${state.message}]`;
  if (state.step === "done") {
    const lines = state.result.entries.map((entry) => `${entry.label}: ${OUTCOME_TEXT[entry.outcome]}`);
    return `[${what}: von der Person bestätigt. ${lines.join("; ")}.]`;
  }
  return null;
}

export function ProposalCard({
  signed,
  state,
  onConfirm,
  onDecline,
}: {
  signed: SignedProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { proposal } = signed;
  const creating = proposal.kind === "createBlockers";
  const count = proposal.entries.length;
  const outcomes = state.step === "done" ? state.result.entries : null;

  return (
    <section className="proposal" aria-label="Vorschlag für den Kalender">
      <h2>
        {creating
          ? `${count === 1 ? "Einen Eintrag" : `${count} Einträge`} «${proposal.eventTitle}»`
          : `${count === 1 ? "Einen Blocker" : `${count} Blocker`} «${proposal.processTitle}»`}
        {state.step === "done" || state.step === "declined" ? "" : creating ? " eintragen?" : " löschen?"}
      </h2>
      <ul>
        {proposal.entries.map((entry, index) => (
          <li key={entry.start + entry.end}>
            <span>{entry.label}</span>
            {"status" in entry && entry.status !== "free" ? (
              <span className="hint">
                {STATUS_TEXT[entry.status]}
                {entry.notes.length > 0 ? `: ${entry.notes.join(", ")}` : ""}
              </span>
            ) : null}
            {"title" in entry && entry.title !== `Blocker ${proposal.processTitle}` ? (
              <span className="hint">{entry.title}</span>
            ) : null}
            {outcomes?.[index] ? (
              <span className={`outcome ${outcomes[index].outcome}`}>{OUTCOME_TEXT[outcomes[index].outcome]}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {proposal.kind === "deleteBlockers" && proposal.kept.length > 0 ? (
        <p className="hint">Bleibt stehen: {proposal.kept.map((entry) => entry.label).join("; ")}</p>
      ) : null}

      {state.step === "open" || state.step === "working" ? (
        <div className="actions">
          <button type="button" onClick={onConfirm} disabled={state.step === "working"}>
            {state.step === "working" ? "Wird ausgeführt …" : creating ? "Eintragen" : "Löschen"}
          </button>
          <button type="button" className="quiet" onClick={onDecline} disabled={state.step === "working"}>
            Verwerfen
          </button>
        </div>
      ) : null}
      {state.step === "declined" ? <p className="hint">Verworfen. Im Kalender wurde nichts geändert.</p> : null}
      {state.step === "error" ? (
        <p role="alert" className="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
