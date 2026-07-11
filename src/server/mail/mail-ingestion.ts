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
 * Enrich a set of message stubs by fetching each message's metadata via
 * `messages.get(format=metadata)`. Called by both `backfillWindow` (bulk
 * window backfill) and inline for search-result / page-token stubs.
 *
 * Skips IDs that are already enriched (have subject + from). Uses
 * `fetchMessageMetadata` (built on the shared `gmailFetch` with
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
 * Pull one window of message IDs via `messages.list`, then enrich each via
 * per-message `messages.get(format=metadata)` to get Subject/From/To/Date,
 * labelIds, snippet, etc.
 *
 * Gmail's `messages.list` only returns `{id, threadId}` — the `format` and
 * `metadataHeaders` params are silently ignored. To get actual metadata we
 * must call `messages.get` for each ID (via `enrichStubs`).
 *
 * Returns the `nextPageToken` the caller persists (per account + view) so
 * the next on-demand window can resume without re-walking from the top.
 */
async function backfillWindow(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
  token: string | null = null,
): Promise<{ synced: number; nextToken: string | null }> {
  const t0 = Date.now();
  const res = await listMessages(client, view, 500, token);

  const ids = (res.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) {
    console.log(`[mail] backfillWindow: no IDs from list, token=${token ?? "null"}`);
    return { synced: 0, nextToken: res.nextPageToken ?? null };
  }

  await enrichStubs(accountId, client, ids);

  const elapsed = Date.now() - t0;
  console.log(
    `[mail] backfillWindow: enriched ${ids.length} messages in ${elapsed}ms, nextToken=${res.nextPageToken ? "present" : "null"}`,
  );

  return { synced: ids.length, nextToken: res.nextPageToken ?? null };
}

export { enrichStubs, backfillWindow };
