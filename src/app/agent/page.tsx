import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/server/better-auth/server";
import { AgentClient } from "./_client";

export default async function AgentPage() {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <Suspense>
      <AgentClient />
    </Suspense>
  );
}
