import { Suspense } from "react";
import { redirect } from "next/navigation";

import { getMailPageData } from "@/server/mail";
import { MailInterface } from "./_client";

type SearchParams = Promise<{ refresh?: string; connected?: string; label?: string; page?: string; id?: string }>;

async function MailPageInner({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const force = sp?.refresh === "true";
  const label = sp?.label ?? "INBOX";
  const page = sp?.page ? Number(sp.page) : 0;
  const id = sp?.id ?? null;

  const data = await getMailPageData({ force, view: label });
  if (!data) redirect("/");

  return <MailInterface initial={data} initialLabel={label} initialPage={page} initialSelectedId={id} />;
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
