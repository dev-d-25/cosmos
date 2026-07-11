import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_SIZE } from "@/server/mail/schemas";

type Row = { data: Record<string, unknown> };

const mockListMessages = vi.fn<(accountId: string, opts?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockListByLabel = vi.fn<(accountId: string, labelIds: string[], opts?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockCountByLabel = vi.fn<() => Promise<number>>();
const mockFindManyByEntityIds = vi.fn<(ids: string[]) => Promise<Row[]>>();
const mockApiMessagesList = vi.fn();
const mockApiMessagesGet = vi.fn();
const mockLabelsList = vi.fn<() => Promise<unknown[]>>();
const mockGetAccessToken = vi.fn<() => Promise<string | null>>();
const mockUpsertManyByEntityIds = vi.fn();

const fakeClient = {
  gmail: {
    db: {
      messages: { findManyByEntityIds: mockFindManyByEntityIds },
      labels: { list: mockLabelsList },
    },
    api: {
      messages: { list: mockApiMessagesList, get: mockApiMessagesGet },
      labels: { list: mockLabelsList },
    },
    keys: { get_access_token: mockGetAccessToken },
  },
};

vi.mock("@/server/corsair", () => ({
  corsair: { withTenant: () => fakeClient },
  getConnectedCorsairPlugins: vi.fn(),
}));

vi.mock("@/server/db/mail-entities", () => ({
  listMessages: mockListMessages,
  listByLabel: mockListByLabel,
  countByLabel: mockCountByLabel,
  upsertManyByEntityIds: mockUpsertManyByEntityIds,
}));

function makeEnrichedRow(id: string, msAgo: number): Row {
  return {
    data: {
      id,
      threadId: `t_${id}`,
      labelIds: ["INBOX"],
      snippet: `snippet ${id}`,
      internalDate: Date.now() - msAgo,
      subject: `Subject ${id}`,
      from: `${id}@example.com`,
      to: "me@example.com",
      unread: true,
      receivedAt: new Date(Date.now() - msAgo).toISOString(),
    },
  };
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) =>
    makeEnrichedRow(`m_${i.toString().padStart(3, "0")}`, i * 1000),
  );
}

describe("assemblePage (rows → response + coverage math)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockListMessages.mockReset();
    mockListByLabel.mockReset();
    mockCountByLabel.mockReset();
    mockFindManyByEntityIds.mockReset();
    mockApiMessagesList.mockReset();
    mockApiMessagesGet.mockReset();
    mockLabelsList.mockReset();
    mockGetAccessToken.mockReset();
    mockUpsertManyByEntityIds.mockReset();

    mockGetAccessToken.mockResolvedValue("fake_access_token");
    mockFindManyByEntityIds.mockResolvedValue([]);
    mockUpsertManyByEntityIds.mockImplementation(async (_a: string, items: Array<{ entityId: string }>) =>
      items.map((i) => ({ data: { id: i.entityId } })),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("assembles an INBOX page from DB rows (items + sorted by receivedAt desc)", async () => {
    const rows = makeRows(PAGE_SIZE);
    mockListByLabel.mockResolvedValueOnce(rows);
    mockLabelsList.mockResolvedValueOnce([{ data: { id: "INBOX", messagesTotal: PAGE_SIZE } }]);
    mockCountByLabel.mockResolvedValueOnce(PAGE_SIZE);

    const { assemblePage } = await import("@/server/mail/mail-page-assembly");
    const result = await assemblePage({ accountId: "a1", client: fakeClient as never }, { labelIds: ["INBOX"] }, 1);

    expect(result.items).toHaveLength(PAGE_SIZE);
    expect(result.items[0]?.id).toBe("m_000");
    expect(result.count).toBe(PAGE_SIZE);
    expect(result.totalPages).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(result.cacheState).toBe("full");
    expect(result.coverage).toBe(1);
    expect(result.source).toBe("cache");
    // Sort order: largest receivedAt first — m_000 is newest (msAgo=0).
    const firstRecv = result.items[0]?.receivedAt;
    const lastRecv = result.items[PAGE_SIZE - 1]?.receivedAt;
    expect(
      firstRecv !== undefined &&
        lastRecv !== undefined &&
        firstRecv >= lastRecv,
    ).toBe(true);
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("computes coverage = dbCount / count when the DB is only partially synced (partial)", async () => {
    const rows = makeRows(10);
    mockListByLabel.mockResolvedValueOnce(rows);
    mockLabelsList.mockResolvedValueOnce([{ data: { id: "INBOX", messagesTotal: 100 } }]);
    mockCountByLabel.mockResolvedValueOnce(10);

    const { assemblePage } = await import("@/server/mail/mail-page-assembly");
    const result = await assemblePage({ accountId: "a1", client: fakeClient as never }, { labelIds: ["INBOX"] }, 1);

    expect(result.count).toBe(100);
    expect(result.cacheState).toBe("partial");
    expect(result.coverage).toBeCloseTo(0.1);
  });

  it("marks cacheState='empty' when there are zero rows in the DB", async () => {
    mockListByLabel.mockResolvedValueOnce([]);
    mockLabelsList.mockResolvedValueOnce([{ data: { id: "INBOX", messagesTotal: 0 } }]);
    mockCountByLabel.mockResolvedValueOnce(0);

    const { assemblePage } = await import("@/server/mail/mail-page-assembly");
    const result = await assemblePage({ accountId: "a1", client: fakeClient as never }, { labelIds: ["INBOX"] }, 1);

    expect(result.items).toEqual([]);
    expect(result.cacheState).toBe("empty");
    expect(result.coverage).toBe(0);
  });

  it("uses listByLabel for a filtered (non-INBOX) view", async () => {
    const rows = makeRows(10).map((r) => ({ ...r, data: { ...r.data, labelIds: ["STARRED"] } }));
    mockListByLabel.mockResolvedValueOnce(rows);
    mockLabelsList.mockResolvedValueOnce([{ data: { id: "STARRED", messagesTotal: 10 } }]);
    mockCountByLabel.mockResolvedValueOnce(10);

    const { assemblePage } = await import("@/server/mail/mail-page-assembly");
    const result = await assemblePage({ accountId: "a1", client: fakeClient as never }, { labelIds: ["STARRED"] }, 1);

    expect(result.items).toHaveLength(10);
    expect(result.count).toBe(10);
    expect(mockListByLabel).toHaveBeenCalledWith("a1", ["STARRED"], expect.objectContaining({ limit: PAGE_SIZE, offset: 0 }));
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it("returns count=null / source='live' for a free-text search view", async () => {
    const apiRows = makeRows(5).map((r) => ({ id: r.data.id }));
    mockApiMessagesList.mockResolvedValueOnce({ messages: apiRows });
    mockFindManyByEntityIds.mockResolvedValue(makeRows(5));
    mockApiMessagesGet.mockImplementation(async (_opts: { id: string }) => {
      const id = _opts.id;
      return {
        id,
        payload: {
          headers: [
            { name: "Subject", value: `Subject ${id}` },
            { name: "From", value: `${id}@example.com` },
          ],
        },
      };
    });

    const { assemblePage } = await import("@/server/mail/mail-page-assembly");
    const result = await assemblePage({ accountId: "a1", client: fakeClient as never }, { query: "from:alice" }, 1);

    expect(result.count).toBeNull();
    expect(result.totalPages).toBeNull();
    expect(result.source).toBe("live");
    expect(result.items).toHaveLength(5);
  });
});
