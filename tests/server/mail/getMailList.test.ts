import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailListItemSchema } from "@/server/mail/schemas";

type Row = {
  data: Record<string, unknown>;
  entity_id?: string;
  entity_type?: string;
};

const mockList =
  vi.fn<(opts?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockCount = vi.fn<() => Promise<number>>();
const mockFindByEntityId = vi.fn<(id: string) => Promise<Row | null>>();
const mockApiMessagesList = vi.fn();
const mockApiMessagesGet = vi.fn();

const mockWithTenant = vi.fn(() => ({
  gmail: {
    db: {
      messages: {
        list: mockList,
        count: mockCount,
        findByEntityId: mockFindByEntityId,
      },
    },
    api: {
      messages: {
        list: mockApiMessagesList,
        get: mockApiMessagesGet,
      },
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

describe("getMailList pagination", () => {
  beforeEach(() => {
    mockList.mockReset();
    mockCount.mockReset();
    mockFindByEntityId.mockReset();
    mockApiMessagesList.mockReset();
    mockApiMessagesGet.mockReset();
    mockWithTenant.mockClear();
    mockGetSessionTenantId.mockReset();
    mockGetSessionTenantId.mockResolvedValue("tenant_1");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no session", async () => {
    mockGetSessionTenantId.mockResolvedValueOnce(null);
    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0 });
    expect(result.items).toEqual([]);
    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBeNull();
  });

  it("serves page 0 entirely from cache when cache covers the request", async () => {
    const rows = makeRows(50);
    mockList.mockResolvedValueOnce(rows);
    mockCount.mockResolvedValueOnce(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBeNull();
    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.id).toBe("m_000");
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("returns a slice for page 1 from cache when more rows are cached than needed", async () => {
    const rows = makeRows(120);
    mockList.mockResolvedValueOnce(rows);
    mockCount.mockResolvedValueOnce(120);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 1, pageSize: 50 });

    expect(result.source).toBe("cache");
    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.id).toBe("m_050");
    expect(result.items[49]?.id).toBe("m_099");
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("serves last partial page from cache when total is not a multiple of pageSize", async () => {
    const rows = makeRows(120);
    mockList.mockResolvedValueOnce(rows);
    mockCount.mockResolvedValueOnce(120);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 2, pageSize: 50 });

    expect(result.source).toBe("cache");
    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.id).toBe("m_100");
    expect(result.items[19]?.id).toBe("m_119");
  });

  it("returns items sorted by receivedAt descending", async () => {
    const rows = makeRows(50);
    mockList.mockResolvedValueOnce(rows);
    mockCount.mockResolvedValueOnce(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    const ids = result.items.map((i) => i.id);
    const expected = makeRows(50).map((r) => r.data.id as string);
    expect(ids).toEqual(expected);
    expect(result.items[0]?.receivedAt).toBeTruthy();
    expect(result.items[0]!.receivedAt >= result.items[49]!.receivedAt).toBe(
      true,
    );
  });

  it("warms cache for page 0 when cache is empty", async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const apiRows = makeRows(50).map((r, i) => ({
      id: r.data.id,
      threadId: r.data.threadId,
    }));
    mockApiMessagesList.mockResolvedValueOnce({
      messages: apiRows,
      nextPageToken: null,
    });
    mockApiMessagesGet.mockResolvedValue({});

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(mockApiMessagesList).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesList).toHaveBeenCalledWith({
      userId: "me",
      maxResults: 50,
      labelIds: ["INBOX"],
    });
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(50);
    expect(mockApiMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ format: "metadata" }),
    );
    expect(result.source).toBe("live");
    expect(result.nextPageToken).toBeNull();
    expect(result.items).toHaveLength(50);
  });

  it("fetches page 1 with a Gmail pageToken and warms metadata", async () => {
    const cached = makeRows(50);
    mockList.mockResolvedValueOnce(cached).mockResolvedValueOnce(cached);
    mockCount.mockResolvedValueOnce(50);

    const newApiRows = makeRows(50).map((r, i) => ({
      id: `p2_${i.toString().padStart(3, "0")}`,
      threadId: `t_${i}`,
    }));
    mockApiMessagesList.mockResolvedValueOnce({
      messages: newApiRows,
      nextPageToken: "page_2_token",
    });
    mockApiMessagesGet.mockResolvedValue({});

    const refreshedRows = [...cached, ...makeRows(50)];
    mockList.mockResolvedValueOnce(refreshedRows);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({
      pageIndex: 1,
      pageSize: 50,
      pageToken: "page_1_token",
    });

    expect(mockApiMessagesList).toHaveBeenCalledWith({
      userId: "me",
      maxResults: 50,
      pageToken: "page_1_token",
      labelIds: ["INBOX"],
    });
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(50);
    expect(result.source).toBe("live");
    expect(result.nextPageToken).toBe("page_2_token");
  });

  it("returns empty page for pageIndex >= 1 with no pageToken and short cache", async () => {
    mockList.mockResolvedValueOnce([]);
    mockCount.mockResolvedValueOnce(0);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 1, pageSize: 50 });

    expect(result.items).toEqual([]);
    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBeNull();
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("skips cache when force is true and warms page 0 from live", async () => {
    mockList.mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const apiRows = makeRows(50).map((r, i) => ({
      id: r.data.id,
      threadId: r.data.threadId,
    }));
    mockApiMessagesList.mockResolvedValueOnce({
      messages: apiRows,
      nextPageToken: null,
    });
    mockApiMessagesGet.mockResolvedValue({});

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({
      pageIndex: 0,
      pageSize: 50,
      force: true,
    });

    expect(mockApiMessagesList).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("live");
  });

  it("clamps pageSize to the 1..100 range", async () => {
    mockList
      .mockResolvedValueOnce(makeRows(50))
      .mockResolvedValueOnce(makeRows(1));
    mockCount.mockResolvedValue(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({
      pageIndex: 0,
      pageSize: 5000,
    });
    expect(result.items).toHaveLength(50);

    const result2 = await getMailList({
      pageIndex: 0,
      pageSize: 0,
    });
    expect(result2.items).toHaveLength(1);
  });

  it("clamps negative pageIndex to 0", async () => {
    mockList.mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: -3, pageSize: 50 });
    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.id).toBe("m_000");
  });

  it("filters out rows whose data does not satisfy MailListItemSchema", async () => {
    const validRows = makeRows(50);
    const invalidRow: Row = { data: {} };
    mockList.mockResolvedValueOnce([...validRows, invalidRow]);
    mockCount.mockResolvedValueOnce(51);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });
    expect(result.items).toHaveLength(50);
    expect(
      result.items.every((i) => MailListItemSchema.safeParse(i).success),
    ).toBe(true);
  });

  it("exposes a cache-page token when more rows exist locally beyond the page", async () => {
    mockList.mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(120);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBe("cache:1");
  });

  it("returns null nextPageToken when the cache holds exactly enough rows", async () => {
    mockList.mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBeNull();
  });

  it("serves cache:N tokens from the local cache with no API call", async () => {
    const rows = makeRows(120);
    mockList.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows);
    mockCount.mockResolvedValueOnce(120).mockResolvedValueOnce(120);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({
      pageToken: "cache:1",
      pageSize: 50,
    });

    expect(result.source).toBe("cache");
    expect(result.items).toHaveLength(50);
    expect(result.items[0]?.id).toBe("m_050");
    expect(result.items[49]?.id).toBe("m_099");
    expect(result.nextPageToken).toBe("cache:2");
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("returns an empty page for a cache:N token beyond the local count", async () => {
    mockList.mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageToken: "cache:5", pageSize: 50 });

    expect(result.items).toEqual([]);
    expect(result.source).toBe("cache");
    expect(result.nextPageToken).toBeNull();
    expect(mockApiMessagesList).not.toHaveBeenCalled();
  });

  it("propagates the Gmail pageToken from the warm-up call when present", async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce(makeRows(50));
    mockCount.mockResolvedValueOnce(50);

    const apiRows = makeRows(50).map((r) => ({
      id: r.data.id,
      threadId: r.data.threadId,
    }));
    mockApiMessagesList.mockResolvedValueOnce({
      messages: apiRows,
      nextPageToken: "gmail_next_token",
    });
    mockApiMessagesGet.mockResolvedValue({});

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(result.source).toBe("live");
    expect(result.nextPageToken).toBe("gmail_next_token");
  });

  it("falls back to a cache-page token after warm-up when Gmail returned no token but more rows are cached", async () => {
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce(makeRows(60));
    mockCount.mockResolvedValueOnce(60);

    const apiRows = makeRows(50).map((r) => ({
      id: r.data.id,
      threadId: r.data.threadId,
    }));
    mockApiMessagesList.mockResolvedValueOnce({
      messages: apiRows,
      nextPageToken: null,
    });
    mockApiMessagesGet.mockResolvedValue({});

    const { getMailList } = await import("@/server/mail");
    const result = await getMailList({ pageIndex: 0, pageSize: 50 });

    expect(result.source).toBe("live");
    expect(result.nextPageToken).toBe("cache:1");
  });
});
