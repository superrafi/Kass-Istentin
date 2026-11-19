import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="login">
      <h1>Kass-Istentin</h1>
      <p>Assistentin für Terminkoordination rund um Kalender und Mail.</p>
      {error ? (
        <p role="alert" className="alert">
          {error === "AccessDenied"
            ? "Dieses Konto hat keinen Zugriff. Melde Dich mit Deinem Firmenkonto an."
            : "Die Anmeldung hat nicht geklappt. Versuch es nochmals."}
        </p>
      ) : null}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button type="submit">Mit Google anmelden</button>
      </form>
    </main>
  );
}
