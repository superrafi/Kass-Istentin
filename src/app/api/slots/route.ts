import { auth } from "@/auth";
import { eventLoaderFor } from "@/lib/calendar/loader";
import { DEFAULT_RULES } from "@/lib/rules/rules";
import { searchSlots } from "@/lib/slots/service";

/**
 * Slot search without the language model, for checking the rules directly.
 * Example: /api/slots?from=2026-11-23&to=2026-11-27&duration=45&count=3&earliest=09:00&avoidLunch=1
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams;
  const outcome = await searchSlots(
    {
      from: query.get("from") ?? "",
      to: query.get("to") ?? query.get("from") ?? "",
      durationMinutes: Number(query.get("duration") ?? 60),
      count: Number(query.get("count") ?? 3),
      mode: query.get("mode") === "onsite" ? "onsite" : "online",
      earliest: query.get("earliest") ?? undefined,
      latest: query.get("latest") ?? undefined,
      avoidLunch: ["1", "true"].includes(query.get("avoidLunch") ?? ""),
    },
    eventLoaderFor(request, DEFAULT_RULES.timeZone),
    DEFAULT_RULES,
    new Date(),
  );

  if (outcome.ok) {
    return Response.json(outcome.result, { headers: { "Cache-Control": "no-store" } });
  }
  if (outcome.error === "invalidRequest") {
    return Response.json({ error: outcome.detail }, { status: 400 });
  }
  return Response.json(
    { error: "calendar", problem: outcome.problem },
    { status: outcome.problem === "unavailable" ? 502 : 403 },
  );
}
