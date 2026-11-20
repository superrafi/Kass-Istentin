import type { SignedProposal } from "@/lib/proposals/types";

/** One line of the chat answer stream (newline-delimited JSON). */
export type StreamEvent =
  | { type: "text"; text: string }
  /** A change to the calendar that waits for the person's confirmation. */
  | { type: "proposal"; proposal: SignedProposal };

export function encodeEvent(event: StreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Splits received text into complete events and the unfinished rest. */
export function decodeEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  return {
    events: lines.filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as StreamEvent),
    rest,
  };
}
