import Image from "next/image";
import { redirect } from "next/navigation";

import { getSession } from "@/server/better-auth/server";
import { SignInButton } from "@/components/auth-buttons";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/mail");

  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-col items-center gap-8">
        <Image
          src="/cosmos-logo-light.webp"
          alt="Cosmos"
          width={400}
          height={120}
          priority
          className="block w-[280px] sm:w-[360px] dark:hidden"
        />
        <Image
          src="/cosmos-logo.webp"
          alt="Cosmos"
          width={400}
          height={120}
          priority
          className="hidden w-[280px] sm:w-[360px] dark:block"
        />

        <p className="text-muted-foreground text-xs font-medium tracking-[0.25em] uppercase">
          AI Email &amp; Calendar Command Center
        </p>

        <SignInButton />
      </div>
    </main>
  );
}
