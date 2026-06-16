import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getMailList, getProfile, getLabels } from "@/server/mail";
import { getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
import { SearchInterface } from "./_client";

type SearchParams = Promise<{ q?: string }>;

async function SearchPageInner({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const query = sp?.q ?? "";

  const tenantId = await getSessionTenantId();
  if (!tenantId) redirect("/");

  const plugins = await getConnectedCorsairPlugins(tenantId);
  const gmailConnected = plugins.includes("gmail");
  if (!gmailConnected) redirect("/mail");

  // Fetch search results if query is provided
  let initialResults = undefined;
  if (query.trim()) {
    const [list, profile, labels] = await Promise.all([
      getMailList({ pageIndex: 0, pageSize: 50, q: query.trim() }),
      getProfile(),
      getLabels(),
    ]);
    initialResults = { list, profile, labels };
  }

  return (
    <SearchInterface
      initialQuery={query}
      initialResults={initialResults}
      gmailConnected={gmailConnected}
    />
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense
      fallback={
        <div className="bg-background text-foreground flex h-screen items-center justify-center">
          Loading search...
        </div>
      }
    >
      <SearchPageInner searchParams={searchParams} />
    </Suspense>
  );
}
