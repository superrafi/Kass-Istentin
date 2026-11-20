import { auth } from "@/auth";
import { eventLoaderFor } from "@/lib/calendar/loader";
import { parseChatRequest } from "@/lib/chat/messages";
import { streamReply } from "@/lib/chat/reply";
import { signProposal } from "@/lib/proposals/sign";
import { DEFAULT_RULES } from "@/lib/rules/rules";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  const secret = process.env.AUTH_SECRET;
  if (!email || !secret) {
    return Response.json({ error: "not signed in" }, { status: 401 });
  }

  const parsed = parseChatRequest(await request.json().catch(() => null));
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const stream = streamReply(parsed.messages, {
    apiKey: process.env.ANTHROPIC_API_KEY || undefined,
    signal: request.signal,
    loadEvents: eventLoaderFor(request, DEFAULT_RULES.timeZone),
    signProposal: (proposal) => signProposal(proposal, email, secret, new Date()),
    rules: DEFAULT_RULES,
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Keeps proxies from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
