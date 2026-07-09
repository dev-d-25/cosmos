"use server";

import { corsair } from "@/server/corsair";
import {
  upsertManyByEntityIds,
  type RawMessageEntity,
  type UpsertItem,
} from "@/server/db/mail-entities";
import { fetchMessageMetadata, listMessages } from "./gmail-adapter";
import { isRowEnriched } from "./mail-read-model";
import { describeError } from "./mail-utils";

const ENRICH_HEADERS = ["Subject", "From", "To", "Date"];

/**
 * Enrich a set of message stubs (rows that lack Subject/From) by fetching each
 * message's `format=metadata` body. This is only ever used for the small sets
 * that already came back from a live Gmail `list` call (search results, token
 * pages) — never for bulk window backfill, which uses `backfillWindow`'s
 * single `list(format=metadata, 500)` instead.
 *
 * Uses `fetchMessageMetadata` (built on the shared `gmailFetch` with
 * 401-refresh + 429-retry) so we don't duplicate retry logic here.
 */
async function enrichStubs(
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

  const raws = await Promise.allSettled(
    needsEnrichment.map((id) => fetchMessageMetadata(client, [id], ENRICH_HEADERS)),
  );

  const upsertItems: UpsertItem[] = [];
  for (const r of raws) {
    if (r.status !== "fulfilled") {
      failed++;
      console.warn(`[mail] enrichStubs: failed for item: ${describeError(r.reason)}`);
      continue;
    }
    const results = r.value;
    for (const { id, raw } of results) {
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

        if (subject === undefined && from === undefined) {
          failed++;
          continue;
        }

        upsertItems.push({
          entityId: id,
          data: {
            ...(raw as RawMessageEntity),
            id,
            subject,
            from,
            to,
          },
        });
        succeeded++;
      } catch (err) {
        failed++;
        console.log(`[mail] enrich parse error for ${id}: ${describeError(err)}`);
      }
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

/**
 * Pull one 500-message window of metadata for a view and upsert the enriched
 * rows. One `list(format=metadata, 500)` call returns id + Subject/From/To/Date
 * for the whole window — zero per-message `get`. Returns the `nextPageToken`
 * the caller persists (per account + view) so the next on-demand window can
 * resume without re-walking from the top.
 *
 * No task queue, no backgrounding: the caller `await`s this inline inside the
 * request that needs it (refresh or on-demand getMailList).
 */
async function backfillWindow(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  token: string | null = null,
): Promise<{ synced: number; nextToken: string | null }> {
  const res = await listMessages(client, view, 500, token);

  const items: UpsertItem[] = (res.messages ?? [])
    .map((m): UpsertItem | null => {
      const id = m.id;
      if (!id) return null;
      const payload = m.payload;
      const headers = payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value;
      return {
        entityId: id,
        data: {
          id,
          threadId: m.threadId,
          snippet: m.snippet,
          internalDate: m.internalDate,
          labelIds: m.labelIds,
          subject: h("Subject"),
          from: h("From"),
          to: h("To"),
          receivedAt: m.internalDate
            ? new Date(Number(m.internalDate)).toISOString()
            : undefined,
        } as RawMessageEntity,
      };
    })
    .filter((x): x is UpsertItem => x !== null);

  if (items.length > 0) {
    await upsertManyByEntityIds(accountId, items);
  }

  return { synced: items.length, nextToken: res.nextPageToken ?? null };
}

export { enrichStubs, backfillWindow };
