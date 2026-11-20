import { auth } from "@/auth";
import { CalendarAccessError } from "@/lib/calendar/google";
import { calendarWriterFor } from "@/lib/calendar/loader";
import { executeProposal } from "@/lib/proposals/execute";
import { verifyProposal } from "@/lib/proposals/sign";
import { DEFAULT_RULES } from "@/lib/rules/rules";

/**
 * Executes a proposal the person confirmed with the button. This is the only
 * place that writes to the calendar, and it accepts nothing but a proposal
 * the app itself signed for this person.
 */
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  const secret = process.env.AUTH_SECRET;
  if (!email || !secret) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  const verified = verifyProposal(body?.token, email, secret, new Date());
  if (!verified.ok) {
    return Response.json({ error: verified.problem }, { status: verified.problem === "expired" ? 410 : 400 });
  }

  try {
    const result = await executeProposal(verified.proposal, calendarWriterFor(request, DEFAULT_RULES.timeZone));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CalendarAccessError) {
      return Response.json(
        { error: "calendar", problem: error.problem },
        { status: error.problem === "unavailable" ? 502 : 403 },
      );
    }
    throw error;
  }
}
