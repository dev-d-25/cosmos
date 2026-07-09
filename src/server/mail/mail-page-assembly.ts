import { corsair } from "@/server/corsair";
import {
  countByLabel,
  listByLabel,
  listMessages,
} from "@/server/db/mail-entities";
import {
  PAGE_SIZE,
} from "./schemas";
import type {
  MailListItem,
  MailListResponse,
} from "./schemas";
import {
  classifyView,
  isFilteredLabelView,
  isRowEnriched,
  rowsToListItems,
  sortByReceivedDesc,
  buildPageMeta,
  resolveCount,
} from "./mail-read-model";
import { enrichStubs } from "./mail-ingestion";
import { toListItem } from "./transformers";
import { describeError } from "./mail-utils";

const INBOX_LABEL = "INBOX";

export interface AssembleContext {
  accountId: string;
  client: ReturnType<typeof corsair.withTenant>;
}

export interface AssembleOpts {
  pageToken?: string | null;
}

/**
 * Single entry point that collapses the four legacy `getMailListFrom*` helpers
 * into one assembler. View classification is delegated to `mail-read-model`
 * (already the source of truth for view/count/meta logic).
 */
export async function assemblePage(
  ctx: AssembleContext,
  view: { labelIds?: string[]; query?: string },
  page: number,
  opts: AssembleOpts = {},
): Promise<MailListResponse> {
  const isSearchView = classifyView(view) === "search";
  if (isSearchView) {
    return assembleSearch(ctx, view.query ?? "", page);
  }

  const isFilteredLabel = isFilteredLabelView(view.labelIds);
  if (isFilteredLabel) {
    return assembleFiltered(ctx, view, page);
  }

  if (opts.pageToken) {
    return assembleGmailToken(ctx, view, page, opts.pageToken);
  }

  return assembleInbox(ctx, view, page);
}

function searchEmpty(page: number): MailListResponse {
  return {
    items: [],
    count: null,
    page,
    totalPages: null,
    hasMore: false,
    hasPrev: page > 1,
    cacheState: "full",
    coverage: 1,
    source: "live",
    degraded: false,
  };
}

async function assembleSearch(
  ctx: AssembleContext,
  q: string,
  page: number,
): Promise<MailListResponse> {
  const { accountId, client } = ctx;

  let apiResult: Record<string, unknown>;
  try {
    apiResult = (await client.gmail.api.messages.list({
      userId: "me",
      maxResults: PAGE_SIZE,
      ...(page > 1 ? { pageToken: undefined } : {}),
      q,
      includeSpamTrash: true,
    })) as Record<string, unknown>;
  } catch (err) {
    console.error(`[mail] search error for q="${q}": ${describeError(err)}`);
    return searchEmpty(page);
  }

  if (!apiResult || Object.keys(apiResult).length === 0) {
    return searchEmpty(page);
  }

  const messages = (apiResult.messages ?? []) as Array<{ id?: string }>;
  const ids = messages
    .map((m) => m.id)
    .filter((id): id is string => !!id);

  if (ids.length === 0) {
    return searchEmpty(page);
  }

  await enrichStubs(accountId, client, ids);

  const existingRows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const rowByEntityId = new Map<string, (typeof existingRows)[number]>();
  for (const row of existingRows) {
    rowByEntityId.set(row.data.id, row);
  }

  const items: MailListItem[] = [];
  for (const id of ids) {
    const row = rowByEntityId.get(id);
    if (row && isRowEnriched(row)) {
      const item = toListItem(row);
      if (item.id) items.push(item);
    }
  }

  return {
    items,
    count: null,
    page,
    totalPages: null,
    hasMore: false,
    hasPrev: page > 1,
    cacheState: "full",
    coverage: 1,
    source: "live",
    degraded: false,
  };
}

async function assembleFiltered(
  ctx: AssembleContext,
  view: { labelIds?: string[]; query?: string },
  page: number,
): Promise<MailListResponse> {
  const { accountId, client } = ctx;
  const offset = (page - 1) * PAGE_SIZE;
  const labelIds = view.labelIds ?? [];

  let rows = await listByLabel(accountId, labelIds, {
    limit: PAGE_SIZE,
    offset,
  });

  const stubIds = rows
    .filter((r) => !isRowEnriched(r))
    .map((r) => r.data.id)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    rows = await listByLabel(accountId, labelIds, { limit: PAGE_SIZE, offset });
  }

  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  const dbCount = await countByLabel(accountId, labelIds);
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "cache",
    degraded,
  };
}

async function assembleInbox(
  ctx: AssembleContext,
  view: { labelIds?: string[]; query?: string },
  page: number,
): Promise<MailListResponse> {
  const { accountId, client } = ctx;
  const offset = (page - 1) * PAGE_SIZE;

  let rows = await listMessages(accountId, {
    limit: PAGE_SIZE,
    offset,
  });

  const stubIds = rows
    .filter((r) => !isRowEnriched(r))
    .map((r) => (r.data as Record<string, unknown>).id as string)
    .filter((id): id is string => !!id);

  if (stubIds.length > 0) {
    await enrichStubs(accountId, client, stubIds);
    rows = await listMessages(accountId, { limit: PAGE_SIZE, offset });
  }

  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  const dbCount = await countByLabel(accountId, [INBOX_LABEL]);
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "cache",
    degraded,
  };
}

async function assembleGmailToken(
  ctx: AssembleContext,
  view: { labelIds?: string[]; query?: string },
  page: number,
  pageToken: string,
): Promise<MailListResponse> {
  const { accountId, client } = ctx;

  const apiResult = (await client.gmail.api.messages.list({
    userId: "me",
    maxResults: PAGE_SIZE,
    pageToken,
    labelIds: view.labelIds ?? [INBOX_LABEL],
  })) as Record<string, unknown>;

  const ids = ((apiResult.messages ?? []) as Array<{ id?: string }>)
    .map((m) => m.id)
    .filter((id: unknown): id is string => typeof id === "string");

  if (ids.length > 0) {
    await enrichStubs(accountId, client, ids);
  }

  const rows = await client.gmail.db.messages.findManyByEntityIds(ids);
  const enriched = rows.filter(isRowEnriched);
  const items = sortByReceivedDesc(rowsToListItems(enriched));

  const { count, degraded } = await resolveCount(accountId, client, view);
  const dbCount = await countByLabel(accountId, [INBOX_LABEL]);
  const { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage } =
    buildPageMeta(page, count, dbCount);

  return {
    items,
    count,
    page: clampedPage,
    totalPages,
    hasMore,
    hasPrev,
    cacheState,
    coverage,
    source: "live",
    degraded,
  };
}
