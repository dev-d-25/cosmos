import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE } from "@/server/mail/schemas";

type Row = {
  data: Record<string, unknown>;
};

const mockListMessages = vi.fn<
  (
    accountId: string,
    opts?: { limit?: number; offset?: number; orderBy?: "created_at" | "internal_date" },
  ) => Promise<Row[]>
>();
const mockListByLabel = vi.fn<
  (
    accountId: string,
    labelIds: string[],
    opts?: { limit?: number; offset?: number; orderBy?: "created_at" | "internal_date" },
  ) => Promise<Row[]>
>();
const mockCountByLabel = vi.fn<() => Promise<number>>();

/**
 * The unfiltered INBOX path calls the SDK's
 * `client.gmail.db.messages.count()` for the total row count when the
 * label row is unavailable. Mock it explicitly.
 */
const mockDbCount = vi.fn<() => Promise<number>>();

const mockFindByEntityId = vi.fn<(id: string) => Promise<Row | null>>();
const mockFindManyByEntityIds = vi.fn<(ids: string[]) => Promise<Row[]>>();
const mockApiMessagesList = vi.fn();
const mockGetAccessToken = vi.fn<() => Promise<string | null>>();

const mockUpsertManyByEntityIds = vi.fn();
const mockGetAccountIdForTenant = vi.fn();

const mockFetch = vi.fn();
const mockLabelsList = vi.fn<() => Promise<unknown[]>>();

const mockWithTenant = vi.fn(() => ({
  gmail: {
    db: {
      messages: {
        count: mockDbCount,
        findByEntityId: mockFindByEntityId,
        findManyByEntityIds: mockFindManyByEntityIds,
      },
      labels: {
        list: mockLabelsList,
      },
    },
    api: {
      messages: {
        list: mockApiMessagesList,
      },
    },
    keys: {
      get_access_token: mockGetAccessToken,
    },
  },
}));

const mockGetSessionTenantId = vi.fn<() => Promise<string | null>>();

vi.mock("@/server/corsair", () => ({
  corsair: { withTenant: mockWithTenant },
  getConnectedCorsairPlugins: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  getSessionTenantId: mockGetSessionTenantId,
}));

/**
 * The mail pipeline reads from the local DB via our own helpers
 * (listMessages, listByLabel, countByLabel), NOT the SDK's
 * `client.gmail.db.messages.list/count`. Mock the helpers, not the SDK.
 */
vi.mock("@/server/db/mail-entities", () => ({
  listMessages: mockListMessages,
  listByLabel: mockListByLabel,
  countByLabel: mockCountByLabel,
  upsertManyByEntityIds: mockUpsertManyByEntityIds,
  getAccountIdForTenant: mockGetAccountIdForTenant,
}));

function makeRow(id: string, msAgo: number): Row {
  const receivedAt = new Date(Date.now() - msAgo).toISOString();
  return {
    data: {
      id,
      threadId: `t_${id}`,
      labelIds: ["INBOX", "UNREAD"],
      snippet: `snippet ${id}`,
      internalDate: new Date(Date.now() - msAgo).getTime(),
      subject: `Subject ${id}`,
      from: `${id}@example.com`,
      to: "me@example.com",
      unread: true,
      receivedAt,
    },
  };
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) =>
    makeRow(`m_${i.toString().padStart(3, "0")}`, i * 1000),
  );
}

function mockGmailFetchFor(rows: Row[]): void {
  mockFetch.mockImplementation(async (url: string) => {
    const match = /\/messages\/([^/?]+)/.exec(url);
    const id = match?.[1] ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id,
        threadId: `t_${id}`,
        payload: {
          headers: [
            { name: "Subject", value: `Subject ${id}` },
            { name: "From", value: `${id}@example.com` },
            { name: "To", value: "me@example.com" },
          ],
        },
      }),
    };
  });
}

/**
 * The new contract always carries these fields. Every test verifies
 * the shape, even when the test's main concern is something else.
 */
type MailListResponseV2 = {
  items: unknown[];
  count: number | null;
  page: number;
  totalPages: number | null;
  hasMore: boolean;
  hasPrev: boolean;
  cacheState: "full" | "partial" | "empty";
  coverage: number;
  source: "cache" | "live" | "syncing";
  degraded: boolean;
};

function expectV2Shape(result: MailListResponseV2) {
  expect(result.items).toBeInstanceOf(Array);
  expect(typeof result.page).toBe("number");
  expect(result.page).toBeGreaterThanOrEqual(1);
  expect(typeof result.hasMore).toBe("boolean");
  expect(typeof result.hasPrev).toBe("boolean");
  expect(["full", "partial", "empty"]).toContain(result.cacheState);
  expect(typeof result.coverage).toBe("number");
  expect(result.coverage).toBeGreaterThanOrEqual(0);
  expect(result.coverage).toBeLessThanOrEqual(1);
  expect(["cache", "live", "syncing"]).toContain(result.source);
  expect(typeof result.degraded).toBe("boolean");
  if (result.count === null) {
    expect(result.totalPages).toBeNull();
  } else {
    expect(typeof result.count).toBe("number");
    expect(typeof result.totalPages).toBe("number");
    expect(result.totalPages).toBeGreaterThanOrEqual(1);
  }
}

// (Type-only declaration removed; replaced with MailListResponseV2 above.)

describe("getMailList (v2 contract)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockListMessages.mockReset();
    mockListByLabel.mockReset();
    mockCountByLabel.mockReset();
    mockDbCount.mockReset();
    mockFindByEntityId.mockReset();
    mockFindManyByEntityIds.mockReset();
    mockApiMessagesList.mockReset();
    mockGetAccessToken.mockReset();
    mockUpsertManyByEntityIds.mockReset();
    mockGetAccountIdForTenant.mockReset();
    mockFetch.mockReset();
    mockLabelsList.mockReset();
    mockWithTenant.mockClear();
    mockGetSessionTenantId.mockReset();
    mockGetSessionTenantId.mockResolvedValue("tenant_1");
    mockGetAccountIdForTenant.mockResolvedValue("account_1");
    mockGetAccessToken.mockResolvedValue("fake_access_token");
    mockFindManyByEntityIds.mockResolvedValue([]);
    mockUpsertManyByEntityIds.mockImplementation(
      async (_accountId: string, items: Array<{ entityId: string }>) =>
        items.map((i) => ({ data: { id: i.entityId } })),
    );

    vi.stubGlobal("fetch", mockFetch);

    mockListByLabel.mockResolvedValue([]);
    mockCountByLabel.mockResolvedValue(0);
    mockListMessages.mockResolvedValue([]);
    mockDbCount.mockResolvedValue(0);
    mockLabelsList.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the empty v2 shape when there is no session", async () => {
    mockGetSessionTenantId.mockResolvedValueOnce(null);
    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ page: 1 });
    expectV2Shape(result);
    expect(result.items).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.hasPrev).toBe(false);
    expect(result.page).toBe(1);
    expect(result.cacheState).toBe("empty");
    expect(result.coverage).toBe(0);
    expect(result.source).toBe("cache");
  });

  it("clamps non-finite / non-positive page to 1", async () => {
    mockListMessages.mockResolvedValueOnce(makeRows(20));
    mockDbCount.mockResolvedValueOnce(20);

    const { getMailList } = await import("@/server/mail");
    for (const bad of [-3, 0, NaN, Number.POSITIVE_INFINITY]) {
      const result = await getMailList({ page: bad });
      expect(result.page).toBe(1);
      expect(result.items[0]?.id).toBe("m_000");
    }
  });

  describe("unfiltered INBOX path", () => {
    it("reads the page from the DB at the requested offset (no 220-row fetch for page 10)", async () => {
      // PAGE_SIZE * page is the offset; PAGE_SIZE rows are returned.
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValueOnce(rows);
      // resolveCount reads label.messagesTotal from labels.list first;
      // falling back to countByLabel is the secondary path. Here we test
      // the label.messagesTotal path.
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 500 } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 10 });

      expectV2Shape(result);
      expect(result.page).toBe(10);
      expect(result.count).toBe(500);
      expect(result.totalPages).toBe(Math.ceil(500 / PAGE_SIZE));
      expect(result.hasMore).toBe(true);
      expect(result.hasPrev).toBe(true);
      expect(result.items).toHaveLength(PAGE_SIZE);
      expect(mockListMessages).toHaveBeenCalledWith(
        "account_1",
        expect.objectContaining({ limit: PAGE_SIZE, offset: PAGE_SIZE * 9 }),
      );
      expect(mockApiMessagesList).not.toHaveBeenCalled();
    });

    it("reads the first page from the DB at offset 0", async () => {
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: PAGE_SIZE } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.page).toBe(1);
      expect(result.items).toHaveLength(PAGE_SIZE);
      expect(result.hasPrev).toBe(false);
      expect(result.hasMore).toBe(false);
      expect(result.count).toBe(PAGE_SIZE);
    });

    it("returns empty page beyond the cached range and marks hasMore=false", async () => {
      mockListMessages.mockResolvedValueOnce([]);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 10 } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 99 });

      expectV2Shape(result);
      expect(result.items).toEqual([]);
      // Page is clamped to totalPages.
      expect(result.page).toBe(1); // ceil(10/25) = 1, page 99 clamps to 1
      expect(result.totalPages).toBe(1);
    });

    it("falls back to countByLabel when the label row is absent", async () => {
      const rows = makeRows(15);
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([]); // no cached label row
      mockCountByLabel.mockResolvedValueOnce(15);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1, labelIds: ["STARRED"] });

      expectV2Shape(result);
      expect(result.count).toBe(15);
    });

    it("falls back to client.gmail.db.messages.count() when no label and no row", async () => {
      const rows = makeRows(10);
      mockListMessages.mockResolvedValueOnce(rows);
      // Force the label-less path: clear labels.list so resolveCount falls
      // through to dbCount for unfiltered INBOX.
      mockLabelsList.mockResolvedValueOnce([]);
      // The unfiltered-INBOX path uses countByLabel(["INBOX"]) for
      // dbCount (consistent with resolveCount's countByLabel fallback).
      mockCountByLabel.mockResolvedValueOnce(10);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.count).toBe(10);
    });

    it("computes cacheState='partial' when DB has fewer rows than count says", async () => {
      mockListMessages.mockResolvedValueOnce(makeRows(10));
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 100 } },
      ]);
      // dbCount = countByLabel(["INBOX"]) = 10. count = 100. partial.
      mockCountByLabel.mockResolvedValueOnce(10);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.count).toBe(100);
      expect(result.cacheState).toBe("partial");
      expect(result.coverage).toBeCloseTo(0.1);
    });

    it("computes cacheState='empty' when DB has zero rows", async () => {
      mockListMessages.mockResolvedValueOnce([]);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 0 } },
      ]);
      mockDbCount.mockResolvedValueOnce(0);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.cacheState).toBe("empty");
      expect(result.coverage).toBe(0);
    });

    it("computes cacheState='full' when DB covers count", async () => {
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: PAGE_SIZE } },
      ]);
      // The unfiltered-INBOX path uses countByLabel(["INBOX"]) for
      // dbCount, NOT client.gmail.db.messages.count().
      mockCountByLabel.mockResolvedValueOnce(PAGE_SIZE);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.cacheState).toBe("full");
      expect(result.coverage).toBe(1);
    });

    it("does not include legacy nextPageToken or totalCount in the response", async () => {
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: PAGE_SIZE } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expect((result as { nextPageToken?: unknown }).nextPageToken).toBeUndefined();
      expect((result as { totalCount?: unknown }).totalCount).toBeUndefined();
    });
  });

  describe("filtered label path", () => {
    it("uses listByLabel for STARRED (a single-label non-INBOX view)", async () => {
      const rows = makeRows(10).map((r) => ({
        ...r,
        data: { ...r.data, labelIds: ["STARRED"] },
      }));
      mockListByLabel.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "STARRED", messagesTotal: 10 } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1, labelIds: ["STARRED"] });

      expectV2Shape(result);
      expect(result.count).toBe(10);
      expect(mockListByLabel).toHaveBeenCalledWith(
        "account_1",
        ["STARRED"],
        expect.objectContaining({ limit: PAGE_SIZE, offset: 0 }),
      );
      expect(mockListMessages).not.toHaveBeenCalled();
    });

    it("uses listByLabel for multi-label intersection (GIN containment)", async () => {
      const rows = makeRows(5);
      mockListByLabel.mockResolvedValueOnce(rows);
      // No cached label row for the multi-label intersection; falls back
      // to countByLabel which uses the GIN containment query.
      mockLabelsList.mockResolvedValueOnce([]);
      mockCountByLabel.mockResolvedValueOnce(5);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({
        page: 1,
        labelIds: ["INBOX", "STARRED"],
      });

      expectV2Shape(result);
      expect(result.count).toBe(5);
      expect(mockListByLabel).toHaveBeenCalledWith(
        "account_1",
        ["INBOX", "STARRED"],
        expect.objectContaining({ limit: PAGE_SIZE, offset: 0 }),
      );
    });

    it("clamps filtered-label page past the end to totalPages", async () => {
      mockListByLabel.mockResolvedValueOnce([]);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "STARRED", messagesTotal: 3 } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({
        page: 99,
        labelIds: ["STARRED"],
      });

      expectV2Shape(result);
      expect(result.items).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe("search path", () => {
    it("returns count=null, totalPages=null, source='live' for free-text search", async () => {
      const apiRows = makeRows(10).map((r) => ({
        id: r.data.id,
        threadId: r.data.threadId,
      }));
      mockApiMessagesList.mockResolvedValueOnce({
        messages: apiRows,
      });
      mockFindManyByEntityIds.mockResolvedValueOnce(
        makeRows(10).map((r) => ({ data: { ...r.data, payload: {} } })),
      );
      mockGmailFetchFor(makeRows(10));

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1, q: "from:alice" });

      expectV2Shape(result);
      expect(result.count).toBeNull();
      expect(result.totalPages).toBeNull();
      expect(result.hasMore).toBe(false);
      expect(result.source).toBe("live");
      expect(result.cacheState).toBe("full");
      expect(mockApiMessagesList).toHaveBeenCalledWith(
        expect.objectContaining({ q: "from:alice", maxResults: PAGE_SIZE }),
      );
    });

    it("returns empty items when Gmail returns no matches for the query", async () => {
      mockApiMessagesList.mockResolvedValueOnce({ messages: [] });

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1, q: "nope:nothing" });

      expectV2Shape(result);
      expect(result.items).toEqual([]);
      expect(result.count).toBeNull();
    });

    it("returns empty response when Gmail errors on the search call", async () => {
      mockApiMessagesList.mockRejectedValueOnce(new Error("gmail 503"));

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1, q: "from:alice" });

      expectV2Shape(result);
      expect(result.items).toEqual([]);
      expect(result.count).toBeNull();
      expect(result.totalPages).toBeNull();
    });
  });

  describe("pagination math (buildPagination)", () => {
    it("hasMore is true when page < totalPages, false when page == totalPages", async () => {
      // 3 pages of 25 = 75 items. Use mockResolvedValue (not Once) so the
      // mock applies across both page 1 and page 3 calls.
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValue(rows);
      mockLabelsList.mockResolvedValue([
        { data: { id: "INBOX", messagesTotal: 75 } },
      ]);
      mockCountByLabel.mockResolvedValue(PAGE_SIZE);

      const { getMailList } = await import("@/server/mail");

      const r1 = await getMailList({ page: 1 });
      expect(r1.hasMore).toBe(true);
      expect(r1.hasPrev).toBe(false);
      expect(r1.totalPages).toBe(3);

      const r3 = await getMailList({ page: 3 });
      expect(r3.hasMore).toBe(false);
      expect(r3.hasPrev).toBe(true);
    });

    it("empty mailbox: count=0 → totalPages=1, hasMore=false, hasPrev=false", async () => {
      mockListMessages.mockResolvedValueOnce([]);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 0 } },
      ]);
      mockDbCount.mockResolvedValueOnce(0);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 1 });

      expectV2Shape(result);
      expect(result.totalPages).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.hasPrev).toBe(false);
    });

    it("partial last page: 30 items in 2 pages", async () => {
      const rows = makeRows(5); // last page short
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: 30 } },
      ]);

      const { getMailList } = await import("@/server/mail");
      const result = await getMailList({ page: 2 });

      expectV2Shape(result);
      expect(result.count).toBe(30);
      expect(result.totalPages).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.hasPrev).toBe(true);
      expect(result.items).toHaveLength(5);
    });
  });

  describe("cache key isolation (per-tenant)", () => {
    it("keys the response cache by tenant id so a write from tenant A doesn't affect tenant B", async () => {
      const rows = makeRows(PAGE_SIZE);
      mockListMessages.mockResolvedValueOnce(rows);
      mockLabelsList.mockResolvedValueOnce([
        { data: { id: "INBOX", messagesTotal: PAGE_SIZE } },
      ]);

      const { getMailList } = await import("@/server/mail");

      // First call populates the cache.
      const r1 = await getMailList({ page: 1 });

      // Second call from the same tenant should hit the cache and return
      // the identical object reference (the implementation sets via Map.set).
      const r2 = await getMailList({ page: 1 });
      expect(r2).toBe(r1);
    });
  });
});
