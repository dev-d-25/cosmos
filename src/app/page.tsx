import Image from "next/image";

import { getSession } from "@/server/better-auth/server";
import { SignInButton, SignOutButton } from "@/components/auth-buttons";
import { ConnectButton } from "@/components/connect-button";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
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
          className="w-[280px] sm:w-[360px] block dark:hidden"
        />
        <Image
          src="/cosmos-logo.webp"
          alt="Cosmos"
          width={400}
          height={120}
          priority
          className="w-[280px] sm:w-[360px] hidden dark:block"
        />

        <p className="text-xs font-medium tracking-[0.25em] text-muted-foreground uppercase">
          AI Email &amp; Calendar Command Center
        </p>

        {session ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex gap-3">
              <ConnectButton plugin="gmail" />
              <ConnectButton plugin="googlecalendar" />
            </div>
            <SignOutButton />
          </div>
        ) : (
          <SignInButton />
        )}
      </div>
    </main>
  );
}
