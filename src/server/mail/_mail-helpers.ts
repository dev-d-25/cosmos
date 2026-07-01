import { corsair } from "@/server/corsair";
import {
  type RawMessageEntity,
  type UpsertItem,
  upsertManyByEntityIds,
} from "@/server/db/mail-entities";
import { fetchMessageMetadata } from "./gmail-adapter";

function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      status?: number;
      code?: number | string;
      message?: string;
    };
    if (e.status) return `HTTP ${e.status}`;
    if (e.code != null) return `code ${e.code}`;
    if (e.message) return e.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

function isRowEnriched(row: { data: Record<string, unknown> }): boolean {
  const d = row.data;
  if (typeof d.from === "string" && d.from.trim() !== "") return true;
  const payload = d.payload as
    | { headers?: Array<{ name?: string; value?: string }> }
    | undefined;
  const headers = payload?.headers;
  if (Array.isArray(headers)) {
    const hasFrom = headers.some(
      (h) =>
        h.name?.toLowerCase() === "from" &&
        typeof h.value === "string" &&
        h.value.trim() !== "",
    );
    if (hasFrom) return true;
  }
  return false;
}

const ENRICH_HEADERS = ["Subject", "From", "To", "Date"];

export async function enrichStubs(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const t0 = Date.now();

  const existingRows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const enrichedIds = new Set<string>();
  for (const row of existingRows) {
    if (isRowEnriched(row)) {
      enrichedIds.add(row.data.id);
    }
  }
  const needsEnrichment = ids.filter((id) => !enrichedIds.has(id));

  if (needsEnrichment.length === 0) {
    console.log(`[mail] All ${ids.length} IDs already enriched, skipping Gmail`);
    return;
  }

  let succeeded = 0;
  let failed = 0;

  const metadataResults = await fetchMessageMetadata(client, needsEnrichment, ENRICH_HEADERS);

  const upsertItems: UpsertItem[] = [];
  for (const { id, raw } of metadataResults) {
    try {
      const payload = raw.payload as
        | { headers?: Array<{ name?: string; value?: string }> }
        | undefined;
      const headers = payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
      const subject = get("Subject");
      const from = get("From");
      const to = get("To");

      upsertItems.push({
        entityId: id,
        data: {
          ...(raw as RawMessageEntity),
          id,
          subject,
          from,
          to,
          createdAt: new Date(),
        },
      });
      succeeded++;
    } catch (err) {
      failed++;
      console.log(`[mail] enrich parse error for ${id}: ${describeError(err)}`);
    }
  }

  if (upsertItems.length > 0) {
    try {
      await upsertManyByEntityIds(accountId, upsertItems);
    } catch (err) {
      console.log(`[mail] bulk upsert failed (${upsertItems.length} items): ${describeError(err)}`);
    }
  }

  const elapsed = Date.now() - t0;
  console.log(
    `[mail] Enriched ${succeeded}/${needsEnrichment.length} | failed=${failed} in ${elapsed}ms`,
  );
}

export { isRowEnriched, describeError };
