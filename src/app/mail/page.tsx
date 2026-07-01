import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getMailPageData } from "@/server/mail";
import { MailInterface } from "./_client";

type SearchParams = Promise<{
  refresh?: string;
  connected?: string;
  label?: string;
  page?: string;
  id?: string;
}>;

async function MailPageInner({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const label = sp?.label ?? "INBOX";
  const rawPage = sp?.page ? Number(sp.page) : 1;
  const page = Number.isFinite(rawPage) && rawPage >= 1
    ? Math.floor(rawPage)
    : 1;

  const data = await getMailPageData({ view: label, page });
  if (!data) redirect("/");

  return <MailInterface initial={data} initialLabel={label} />;
}

export default async function MailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<div className="bg-background text-foreground flex h-screen items-center justify-center">Loading mail...</div>}>
      <MailPageInner searchParams={searchParams} />
    </Suspense>
  );
}
