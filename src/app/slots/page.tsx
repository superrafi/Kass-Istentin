import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { eventLoaderFor } from "@/lib/calendar/loader";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import type { PresentedSlotResult } from "@/lib/slots/present";
import { searchSlots, type SlotSearchOutcome } from "@/lib/slots/service";
import { CALENDAR_PROBLEM_TEXT, DAY_STATUS_TEXT, OCCUPANCY_REASON_TEXT } from "@/lib/slots/wording";
import { addDays, isoWeekday, localDateOf } from "@/lib/time/zoned";

type Entry = NonNullable<PresentedSlotResult["days"][number]["blocked_by"]>[number];

function swissDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function entryText(entry: Entry): string {
  const when = "all_day" in entry ? "ganztägig" : `${entry.start}–${entry.end}`;
  const place = entry.location ? `, ${entry.location}` : entry.online ? ", online" : "";
  return `${when} ${entry.title}${place}`;
}

function Neighbour({ label, entry }: { label: string; entry?: Entry & { gap_minutes: number } }) {
  return (
    <p className="hint">
      {label}:{" "}
      {entry
        ? `${entryText(entry)} (${entry.gap_minutes === 0 ? "direkt anschliessend" : `${entry.gap_minutes} Min. Abstand`})`
        : "nichts"}
    </p>
  );
}

function Results({ outcome }: { outcome: SlotSearchOutcome }) {
  if (!outcome.ok) {
    return (
      <p role="alert" className="alert">
        {outcome.error === "calendar"
          ? CALENDAR_PROBLEM_TEXT[outcome.problem]
          : "Die Angaben sind nicht gültig. Prüf Zeitraum, Dauer und Uhrzeiten."}
      </p>
    );
  }
  const { proposals, days } = outcome.result;
  return (
    <>
      <section>
        <h2>Vorschläge</h2>
        {proposals.length === 0 ? <p>Im Zeitraum ist nichts frei.</p> : null}
        <ol className="slot-list">
          {proposals.map((proposal) => (
            <li key={proposal.date + proposal.start}>
              <strong>
                {proposal.weekday}, {swissDate(proposal.date)}, {proposal.start}–{proposal.end}
              </strong>
              <Neighbour label="Davor" entry={proposal.before} />
              <Neighbour label="Danach" entry={proposal.after} />
              {proposal.overlaps?.map((entry) => (
                <p key={entryText(entry)} className="alert">
                  Überlagert: {entryText(entry)} ({OCCUPANCY_REASON_TEXT[entry.reason]})
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>Tage im Zeitraum</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Stand</th>
                <th>Besetzt durch</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td>
                    {day.weekday.slice(0, 2)} {swissDate(day.date)}
                  </td>
                  <td>{DAY_STATUS_TEXT[day.status]}</td>
                  <td>
                    {(day.blocked_by ?? []).map((entry) => (
                      <div key={entryText(entry)}>
                        {entryText(entry)}
                        {entry.reason !== "regular" ? ` (${OCCUPANCY_REASON_TEXT[entry.reason]})` : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** A readable view of the slot search, for checking the rules against the real calendar. */
export default async function SlotsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const query = await searchParams;
  const rules = DEFAULT_RULES;
  const now = new Date();
  // Default period: Monday to Friday of next week.
  const today = localDateOf(now, rules.timeZone);
  const nextMonday = addDays(today, 8 - isoWeekday(today));
  const form = {
    from: query.from ?? nextMonday,
    to: query.to ?? addDays(nextMonday, 4),
    duration: query.duration ?? "45",
    count: query.count ?? "3",
    earliest: query.earliest ?? "",
    latest: query.latest ?? "",
    mode: query.mode === "onsite" ? "onsite" : "online",
    avoidLunch: query.avoidLunch === "1",
  } as const;

  const outcome = query.from
    ? await searchSlots(
        {
          from: form.from,
          to: form.to,
          durationMinutes: Number(form.duration),
          count: Number(form.count),
          mode: form.mode,
          earliest: form.earliest || undefined,
          latest: form.latest || undefined,
          avoidLunch: form.avoidLunch,
        },
        eventLoaderFor({ headers: await headers() }, rules.timeZone),
        rules,
        now,
      )
    : null;

  return (
    <div className="shell page">
      <header className="topbar">
        <h1>Slot-Suche prüfen</h1>
        <Link href="/">Zum Chat</Link>
      </header>
      <main>
        <p className="hint">
          Diese Seite zeigt, was die Slot-Suche in Deinem Kalender findet, ohne Sprachmodell. Sie ändert nichts am
          Kalender.
        </p>
        <form className="slot-form" method="get">
          <label>
            Von
            <input type="date" name="from" defaultValue={form.from} required />
          </label>
          <label>
            Bis
            <input type="date" name="to" defaultValue={form.to} required />
          </label>
          <label>
            Dauer (Min.)
            <input type="number" name="duration" min={5} max={600} step={5} defaultValue={form.duration} required />
          </label>
          <label>
            Anzahl
            <input type="number" name="count" min={1} max={20} defaultValue={form.count} required />
          </label>
          <label>
            Nicht vor
            <input type="time" name="earliest" defaultValue={form.earliest} />
          </label>
          <label>
            Nicht nach
            <input type="time" name="latest" defaultValue={form.latest} />
          </label>
          <label>
            Art
            <select name="mode" defaultValue={form.mode}>
              <option value="online">Call</option>
              <option value="onsite">vor Ort</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" name="avoidLunch" value="1" defaultChecked={form.avoidLunch} />
            Nicht über Mittag
          </label>
          <button type="submit">Suchen</button>
        </form>
        {outcome ? <Results outcome={outcome} /> : null}
      </main>
    </div>
  );
}
