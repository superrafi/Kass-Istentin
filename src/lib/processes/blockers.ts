import type { CalendarEvent } from "@/lib/calendar/types";
import type { FindingReason, PollSlot, SlotFinding } from "@/lib/polls/check";
import type { CreateBlockersProposal, DeleteBlockersProposal, ProposalSpan } from "@/lib/proposals/types";
import { weekdayName } from "@/lib/slots/present";
import { localDateOf, localTimeOf, zonedTimeToUtc } from "@/lib/time/zoned";

/** Title word that marks a blocker, also for blockers the person created by hand. */
export const BLOCKER_WORD = "Blocker";
export const MAX_PROCESS_TITLE = 60;

/** A coordination process as it can be read from the calendar: its blockers. */
export interface ProcessSummary {
  /** Reference for tools: the process id, or "title:…" for hand-made blockers. */
  ref: string;
  title: string;
  /** Blockers the person created by hand, recognised by their title. */
  manual: boolean;
  blockers: CalendarEvent[];
}

const NOTE_TEXT: Record<FindingReason, string> = {
  conflict: "überschneidet sich mit",
  homeOffice: "Homeoffice",
  past: "liegt in der Vergangenheit",
  movable: "überlagert verschiebbaren Termin",
  tentative: "überlagert vorläufig zugesagten Termin",
  placeBefore: "kurz davor ausser Haus",
  placeAfter: "kurz danach ausser Haus",
  outsideHours: "ausserhalb der üblichen Zeiten",
  notAWorkday: "kein Arbeitstag",
};

export function spanLabel(start: Date, end: Date, timeZone: string): string {
  const date = localDateOf(start, timeZone);
  const [year, month, day] = date.split("-");
  return `${weekdayName(date)}, ${day}.${month}.${year}, ${localTimeOf(start, timeZone)}–${localTimeOf(end, timeZone)}`;
}

function span(start: Date, end: Date, timeZone: string): ProposalSpan {
  return { start: start.toISOString(), end: end.toISOString(), label: spanLabel(start, end, timeZone) };
}

export function cleanProcessTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_PROCESS_TITLE);
}

export function blockerTitle(processTitle: string): string {
  return `${BLOCKER_WORD} ${processTitle}`;
}

function isBlockerTitle(title: string): boolean {
  return title.toLowerCase().includes(BLOCKER_WORD.toLowerCase());
}

/** A blocker is an entry of a process, or an entry the person named "Blocker …". */
export function isBlocker(event: CalendarEvent): boolean {
  return !event.cancelled && (event.processId !== undefined || isBlockerTitle(event.title));
}

/**
 * Proposes blockers for the slots of a poll that are not busy. Slots that
 * already have a blocker of this process are left out, so no duplicates arise.
 */
export function buildCreateProposal(
  process: { id: string; title: string },
  findings: SlotFinding[],
  timeZone: string,
): { proposal: CreateBlockersProposal | null; skipped: { label: string; reason: "busy" | "alreadyBlocked" }[] } {
  const title = cleanProcessTitle(process.title);
  const entries: CreateBlockersProposal["entries"] = [];
  const skipped: { label: string; reason: "busy" | "alreadyBlocked" }[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const entry = span(finding.start, finding.end, timeZone);
    if (seen.has(entry.start + entry.end)) continue;
    seen.add(entry.start + entry.end);
    if (finding.alreadyBlocked) skipped.push({ label: entry.label, reason: "alreadyBlocked" });
    else if (finding.status === "busy") skipped.push({ label: entry.label, reason: "busy" });
    else {
      entries.push({
        ...entry,
        status: finding.status,
        notes: finding.reasons.map((reason) =>
          reason.event ? `${NOTE_TEXT[reason.code]}: ${reason.event.title}` : NOTE_TEXT[reason.code],
        ),
      });
    }
  }
  if (entries.length === 0 || !title) return { proposal: null, skipped };
  return {
    proposal: {
      kind: "createBlockers",
      processId: process.id,
      processTitle: title,
      eventTitle: blockerTitle(title),
      entries,
    },
    skipped,
  };
}

function titleRef(title: string): string {
  return `title:${title.trim().toLowerCase()}`;
}

/** Groups the blockers found in the calendar into processes. */
export function collectProcesses(events: CalendarEvent[]): ProcessSummary[] {
  const processes = new Map<string, ProcessSummary>();
  for (const event of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    if (!isBlocker(event) || event.allDay) continue;
    const manual = event.processId === undefined;
    const ref = event.processId ?? titleRef(event.title);
    const known = processes.get(ref);
    if (known) known.blockers.push(event);
    else {
      const withoutWord = event.title.replace(new RegExp(`^\\s*${BLOCKER_WORD}\\s*`, "i"), "").trim();
      processes.set(ref, { ref, title: withoutWord || event.title.trim(), manual, blockers: [event] });
    }
  }
  return [...processes.values()];
}

/**
 * Proposes to delete the blockers of a process. With `keep`, the blocker of
 * the confirmed slot stays.
 */
export function buildDeleteProposal(
  process: ProcessSummary,
  timeZone: string,
  keep?: PollSlot,
): DeleteBlockersProposal | null {
  const keepStart = keep ? zonedTimeToUtc(keep.date, keep.start, timeZone).getTime() : null;
  const entries: DeleteBlockersProposal["entries"] = [];
  const kept: ProposalSpan[] = [];
  for (const blocker of process.blockers) {
    const entry = span(blocker.start, blocker.end, timeZone);
    if (blocker.start.getTime() === keepStart) kept.push(entry);
    else entries.push({ ...entry, eventId: blocker.id, title: blocker.title });
  }
  if (entries.length === 0) return null;
  return { kind: "deleteBlockers", processTitle: process.title, entries, kept };
}
