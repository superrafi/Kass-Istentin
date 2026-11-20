import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Chat } from "@/components/Chat";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Kass-Istentin</h1>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <Link href="/slots">Slot-Suche</Link>
          <span className="who">{session.user.name ?? session.user.email}</span>
          <button type="submit" className="quiet">
            Abmelden
          </button>
        </form>
      </header>
      <Chat />
    </div>
  );
}
