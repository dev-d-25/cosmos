"use server";

import { corsair, getConnectedCorsairPlugins } from "@/server/corsair";
import { getSessionTenantId } from "@/server/auth";
import {
  getAccountIdForTenant,
  getMailSyncState,
  upsertMailSyncState,
} from "@/server/db/mail-entities";
import type {
  MailListResponse,
  MailPageData,
  MailProfile,
} from "./schemas";
import { MAX_PAGE, MAX_WINDOWS } from "./schemas";
import { MAIL_LABELS } from "@/lib/mail/labels";
import {
  emptyResponse,
} from "./mail-read-model";
import {
  classifyView,
  viewKeyFor,
} from "./mail-read-model";
import {
  getMailListCacheKey,
  checkMailListCache,
  setMailListCache,
  invalidateMailListCacheForTenant,
} from "./mail-page-cache";
import { assemblePage } from "./mail-page-assembly";
import { backfillWindow } from "./mail-ingestion";

const INBOX_LABEL = "INBOX";

export async function getClient() {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;
  const accountId = await getAccountIdForTenant(tenantId);
  if (!accountId) return null;
  return { tenantId, accountId, client: corsair.withTenant(tenantId) };
}

export interface GetMailListOpts {
  page?: number;
  labelIds?: string[];
  q?: string;
  pageToken?: string | null;
}

export async function getMailList(
  opts: GetMailListOpts = {},
): Promise<MailListResponse> {
  const ctx = await getClient();
  if (!ctx) return emptyResponse();
  const { tenantId, accountId, client } = ctx;

  const q = opts.q;
  const labelIds = q ? [] : (opts.labelIds ?? [INBOX_LABEL]);
  const view = { labelIds, query: q };

  const rawPage = opts.page ?? 1;
  const finitePage = Number.isFinite(rawPage) ? rawPage : 1;
  const requestedPage = Math.min(MAX_PAGE, Math.max(1, Math.floor(finitePage)));

  const cacheKey = getMailListCacheKey(tenantId, view, requestedPage);
  const cached = checkMailListCache(cacheKey);
  if (cached) return cached;

  console.log(
    `[mail-debug] getMailList view=${JSON.stringify(view)} page=${requestedPage}`,
  );

  const result = await assemblePageWithBackfill(
    { accountId, client },
    view,
    requestedPage,
    opts.pageToken ?? null,
  );

  // Never cache an empty page: doing so would mask "not yet backfilled" and
  // block on-demand backfill on the next visit. Empty mailboxes re-read the
  // DB cheaply (no Gmail call), so the cost is negligible.
  if (result.items.length > 0) {
    if (result.source === "syncing") {
      // A backfill ran and may have filled neighbouring pages too.
      invalidateMailListCacheForTenant(tenantId);
    }
    setMailListCache(cacheKey, result);
  }
  return result;
}

/**
 * Assemble the requested page, then — if it is empty but more mail should exist
 * for this label view — chain on-demand backfill windows (bounded by
 * MAX_WINDOWS) until the page fills or the mailbox is exhausted.
 *
 * One mechanism covers normal browsing, end-of-window, and direct jumps. No
 * unbounded fan-out: each window is exactly one `list(format=metadata, 500)`
 * call, and we stop after MAX_WINDOWS chained windows or when Gmail returns no
 * nextPageToken.
 */
async function assemblePageWithBackfill(
  ctx: { accountId: string; client: ReturnType<typeof corsair.withTenant> },
  view: { labelIds?: string[]; query?: string },
  requestedPage: number,
  pageToken: string | null,
): Promise<MailListResponse> {
  let result = await assemblePage(ctx, view, requestedPage, { pageToken });
  if (result.items.length > 0) return result;

  // Only label views backfill from the DB cursor; search is served live by
  // Gmail and never has a persisted token.
  if (classifyView(view) === "search") return result;
  // Nothing to fetch.
  if (result.count == null || result.count <= 0) return result;

  const viewKey = viewKeyFor(view);
  let windows = 0;

  while (windows < MAX_WINDOWS) {
    const state = await getMailSyncState(ctx.accountId, viewKey);
    const token = state?.nextPageToken ?? null;

    // No token means we've already walked to the end of the mailbox.
    if (state && !token) break;
    // Ceiling: don't chain more windows than MAX_WINDOWS per logical walk.
    if ((state?.windowIndex ?? 0) + 1 > MAX_WINDOWS) break;

    let nextToken: string | null;
    try {
      const res = await backfillWindow(ctx.accountId, ctx.client, view, token);
      nextToken = res.nextToken;
    } catch (err) {
      console.log(`[mail] on-demand backfill failed: ${String(err)}`);
      break;
    }

    await upsertMailSyncState(
      ctx.accountId,
      viewKey,
      nextToken,
      (state?.windowIndex ?? 0) + 1,
    );
    windows++;

    result = await assemblePage(ctx, view, requestedPage, { pageToken });
    if (result.items.length > 0) {
      // Mark as syncing so the caller can invalidate sibling page caches.
      return { ...result, source: "syncing" };
    }
    if (!nextToken) break;
  }

  return result;
}

export async function getMailPageData(
  opts: { force?: boolean; view?: string; page?: number } = {},
): Promise<MailPageData | null> {
  const tenantId = await getSessionTenantId();
  if (!tenantId) return null;

  const plugins = await getConnectedCorsairPlugins(tenantId);
  const gmailConnected = plugins.includes("gmail");
  if (!gmailConnected) {
    return { tenantId, gmailConnected: false };
  }

  const view = opts.view ?? "INBOX";
  const page = Math.max(1, Math.floor(opts.page ?? 1));

  const labelDef = MAIL_LABELS.find((l) => l.id === view);
  let labelIds: string[] | undefined;
  let viewQuery: string | undefined;
  if (labelDef?.gmailQuery) {
    viewQuery = labelDef.gmailQuery;
    labelIds = undefined;
  } else if (labelDef?.gmailLabel) {
    labelIds = [labelDef.gmailLabel];
  } else {
    labelIds =
      view.startsWith("CATEGORY_") || view.startsWith("Label_")
        ? [view]
        : undefined;
  }

  const { getProfile, getLabels } = await import("./mail-profile");

  const [list, profile, labels] = await Promise.all([
    getMailList({
      page,
      labelIds,
      q: viewQuery,
    }),
    getProfile(),
    getLabels(),
  ]);

  return { tenantId, gmailConnected: true, view, list, profile, labels };
}
