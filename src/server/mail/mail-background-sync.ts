"use server";

import { getClient } from "./mail-list";
import { invalidateMailListCacheForTenant } from "./mail-page-cache";
import { invalidateLabelCount } from "./label-count-cache";
import { backfillWindow } from "./mail-ingestion";
import {
  upsertMailSyncState,
} from "@/server/db/mail-entities";
import { MAIL_LABELS } from "@/lib/mail/labels";
import { viewKeyFor } from "./mail-read-model";
import { describeError } from "./mail-utils";

const INBOX_LABEL = "INBOX";

/**
 * Resolve the gmail api params (labelIds / query) for a UI view id.
 * Mirrors the resolver used by getMailPageData so refresh and list agree.
 */
function viewParamsForViewId(viewId: string): {
  labelIds?: string[];
  query?: string;
} {
  const viewDef = MAIL_LABELS.find((l) => l.id === viewId) ?? MAIL_LABELS[0];
  if (viewDef?.gmailQuery) return { query: viewDef.gmailQuery };
  if (viewDef?.gmailLabel) return { labelIds: [viewDef.gmailLabel] };
  if (viewId.startsWith("CATEGORY_") || viewId.startsWith("Label_")) {
    return { labelIds: [viewId] };
  }
  return { labelIds: [INBOX_LABEL] };
}

export async function refreshInbox(
  viewId: string = "INBOX",
  _page: number = 1,
): Promise<{ synced: number }> {
  const ctx = await getClient();
  if (!ctx) return { synced: 0 };
  const { tenantId, accountId, client } = ctx;

  await invalidateMailListCacheForTenant(tenantId);

  const view = viewParamsForViewId(viewId);
  const viewKey = viewKeyFor(view);

  if (view.labelIds) {
    for (const labelId of view.labelIds) {
      invalidateLabelCount(accountId, labelId);
    }
  }

  // Window 1: pull the newest 500 via a single list(format=metadata) call and
  // persist the nextPageToken so on-demand navigation can chain windows.
  let syncResult;
  try {
    syncResult = await backfillWindow(accountId, client, view, null);
    await upsertMailSyncState(accountId, viewKey, syncResult.nextToken, 1);
  } catch (err) {
    console.log(`[mail] refreshInbox backfill failed: ${describeError(err)}`);
    return { synced: 0 };
  }

  try {
    await client.gmail.api.labels.list({});
  } catch (err) {
    console.log(`[mail] refreshInbox: labels.list failed: ${describeError(err)}`);
  }

  await invalidateMailListCacheForTenant(tenantId);

  return { synced: syncResult.synced };
}
