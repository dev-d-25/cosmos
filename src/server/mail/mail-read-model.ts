"use server";

import { corsair } from "@/server/corsair";
import {
  countByLabel,
} from "@/server/db/mail-entities";
import {
  getLabelCount as getCachedLabelCount,
} from "./label-count-cache";
import { toListItem } from "./transformers";
import {
  PAGE_SIZE,
} from "./schemas";
import type {
  MailListItem,
  MailListResponse,
} from "./schemas";

const INBOX_LABEL = "INBOX";

// ─── View classification ─────────────────────────────────────

export function isFilteredLabelView(labelIds: string[] | undefined): boolean {
  if (!labelIds || labelIds.length === 0) return false;
  return labelIds.length > 1 || labelIds[0] !== INBOX_LABEL;
}

type ViewKind = "label" | "query" | "search";

export function classifyView(view: {
  labelIds?: string[];
  query?: string;
}): ViewKind {
  if (view.query) return view.labelIds?.length ? "label" : "search";
  return "label";
}

// ─── Row helpers ─────────────────────────────────────────────

export function isRowEnriched(row: { data: Record<string, unknown> }): boolean {
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

export function sortByReceivedDesc(items: MailListItem[]): MailListItem[] {
  return [...items].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function rowsToListItems(
  rows: Array<{ data: Record<string, unknown> }>,
): MailListItem[] {
  const seen = new Set<string>();
  return rows
    .map((r) => toListItem(r))
    .filter((item): item is MailListItem => {
      if (item.id === "" || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

// ─── Count resolution ────────────────────────────────────────

export async function resolveCount(
  accountId: string,
  client: ReturnType<typeof corsair.withTenant>,
  view: { labelIds?: string[]; query?: string },
): Promise<{ count: number | null; degraded: boolean }> {
  if (classifyView(view) === "search") {
    return { count: null, degraded: false };
  }

  if (view.labelIds?.length === 1) {
    const labelId = view.labelIds[0];
    if (!labelId) {
      const dbCount = await countByLabel(accountId, view.labelIds);
      return { count: dbCount, degraded: false };
    }
    try {
      const labels = await client.gmail.db.labels.list();
      const row = labels.find(
        (l) => (l.data as Record<string, unknown>).id === labelId,
      );
      const labelTotal = row
        ? ((row.data as Record<string, unknown>).messagesTotal as
            | number
            | undefined)
        : undefined;
      if (typeof labelTotal === "number" && labelTotal >= 0) {
        return { count: labelTotal, degraded: false };
      }
    } catch {
      // fall through to live labels.get
    }

    try {
      const cachedTotal = await getCachedLabelCount(accountId, labelId, async () => {
        const label = await client.gmail.api.labels.get({ id: labelId });
        const apiTotal = (label as Record<string, unknown>).messagesTotal as
          | number
          | undefined;
        return typeof apiTotal === "number" && apiTotal >= 0 ? apiTotal : null;
      });
      if (typeof cachedTotal === "number") {
        return { count: cachedTotal, degraded: false };
      }
    } catch {
      // fall through to DB count
    }
  }

  const dbCount = view.labelIds?.length
    ? await countByLabel(accountId, view.labelIds)
    : await client.gmail.db.messages.count();
  return { count: dbCount, degraded: false };
}

// ─── Page metadata ──────────────────────────────────────────

export function buildPageMeta(
  page: number,
  count: number | null,
  dbCount: number,
): {
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  hasPrev: boolean;
  cacheState: "full" | "partial" | "empty";
  coverage: number;
} {
  const { cacheState, coverage } = computeCacheState(count, dbCount);
  const { page: clampedPage, totalPages, hasMore, hasPrev } =
    buildPagination(page, count);
  return { page: clampedPage, totalPages, hasMore, hasPrev, cacheState, coverage };
}

export function emptyResponse(): MailListResponse {
  return {
    items: [],
    count: 0,
    page: 1,
    totalPages: 1,
    hasMore: false,
    hasPrev: false,
    cacheState: "empty",
    coverage: 0,
    source: "cache",
    degraded: false,
  };
}

// ─── In-memory cache ─────────────────────────────────────────

const mailListCache = new Map<string, { data: MailListResponse; at: number }>();
const MAIL_LIST_CACHE_TTL = 30_000;

function hashViewToken(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function viewToken(view: {
  labelIds?: string[];
  query?: string;
}): string {
  if (view.labelIds?.length) return `l:${[...view.labelIds].sort().join("+")}`;
  if (view.query) {
    if (!view.labelIds) return `q:${hashViewToken(view.query)}`;
    return `s:${hashViewToken(view.query)}`;
  }
  return "l:INBOX";
}

export function getMailListCacheKey(
  tenantId: string,
  view: { labelIds?: string[]; query?: string },
  page: number,
): string {
  return `${tenantId}:${viewToken(view)}:${page}`;
}

export function checkMailListCache(
  cacheKey: string,
): MailListResponse | undefined {
  const cached = mailListCache.get(cacheKey);
  if (cached && Date.now() - cached.at < MAIL_LIST_CACHE_TTL) {
    return cached.data;
  }
  return undefined;
}

export function setMailListCache(
  cacheKey: string,
  data: MailListResponse,
): void {
  mailListCache.set(cacheKey, { data, at: Date.now() });
}

export function invalidateMailListCacheForTenant(
  tenantId: string,
  view?: { labelIds?: string[]; query?: string },
): void {
  const prefix = view
    ? `${tenantId}:${viewToken(view)}:`
    : `${tenantId}:`;
  for (const key of Array.from(mailListCache.keys())) {
    if (key.startsWith(prefix)) mailListCache.delete(key);
  }
}

// ─── Internal helpers ────────────────────────────────────────

function computeCacheState(
  count: number | null,
  dbCount: number,
): { cacheState: "full" | "partial" | "empty"; coverage: number } {
  if (dbCount === 0) return { cacheState: "empty", coverage: 0 };
  if (count == null || count === 0) {
    return { cacheState: "full", coverage: 1 };
  }
  if (dbCount >= count) return { cacheState: "full", coverage: 1 };
  return { cacheState: "partial", coverage: dbCount / count };
}

function buildPagination(
  page: number,
  count: number | null,
): {
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  hasPrev: boolean;
} {
  if (count == null) {
    return {
      page,
      totalPages: null,
      hasMore: false,
      hasPrev: page > 1,
    };
  }
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  return {
    page: clampedPage,
    totalPages,
    hasMore: clampedPage < totalPages,
    hasPrev: clampedPage > 1,
  };
}
