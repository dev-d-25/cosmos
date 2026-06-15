import { redirect } from "next/navigation";

import { getMailPageData } from "@/server/mail";
import { MailInterface } from "./_client";

type SearchParams = Promise<{ refresh?: string; connected?: string }>;

export default async function MailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const force = sp?.refresh === "true";

  const data = await getMailPageData({ force });
  if (!data) redirect("/");

  return <MailInterface initial={data} />;
}
