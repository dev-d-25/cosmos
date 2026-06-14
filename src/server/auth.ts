import { auth } from "@/server/better-auth";
import { headers } from "next/headers";

export async function getSessionTenantId(): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session?.user?.id ?? null;
}
