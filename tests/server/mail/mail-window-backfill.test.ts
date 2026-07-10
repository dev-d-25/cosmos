import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory simulation of the mail pipeline so we can assert the on-demand
// window-backfill invariants end-to-end without a real DB or Gmail.
type Row = { data: Record<string, unknown> };

const TENANT = "tenant_wb";
const ACCOUNT = "account_wb";

let dbRows: Row[] = [];
let syncState: { nextPageToken: string | null; windowIndex: number } | null = null;
let listCallCount = 0;
let getMessageCallCount = 0;

const mockListMessages = vi.fn<(a: string, o?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockListByLabel = vi.fn<(a: string, l: string[], o?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockCountByLabel = vi.fn<() => Promise<number>>();
const mockFindManyByEntityIds = vi.fn<(ids: string[]) => Promise<Row[]>>(() => Promise.resolve([]));
const mockUpsert = vi.fn<(a: string, items: Array<{ entityId: string; data: Record<string, unknown> }>) => Promise<Row[]>>();
const mockGetAccountId = vi.fn<() => Promise<string>>(() => Promise.resolve(ACCOUNT));
const mockGetMailSyncState = vi.fn<() => Promise<unknown>>();
const mockUpsertMailSyncState = vi.fn<(a: string, vk: string, token: string | null, idx: number) => Promise<void>>();
const mockApiMessagesList = vi.fn();
const mockApiMessagesGet = vi.fn();
const mockApiLabelsList = vi.fn<() => Promise<unknown[]>>();
const mockDbLabelsList = vi.fn<() => Promise<unknown[]>>();
const mockGetAccessToken = vi.fn<() => Promise<string | null>>(() => Promise.resolve("tok"));

const fakeClient = {
  gmail: {
    db: {
      messages: {
        count: vi.fn<() => Promise<number>>(() => Promise.resolve(dbRows.length)),
        findManyByEntityIds: mockFindManyByEntityIds,
      },
      labels: { list: mockDbLabelsList },
    },
    api: {
      messages: { list: mockApiMessagesList, get: mockApiMessagesGet },
      labels: { list: mockApiLabelsList },
    },
    keys: { get_access_token: mockGetAccessToken },
  },
};

// Each Gmail `list` call returns up to 500 messages for the requested window
// and a nextPageToken (or null once we pass 2500 messages = MAX_WINDOWS * 500).
function gmailWindow(token: string | null) {
  const start = token ? Number(token) * 500 : 0;
  const messages = Array.from({ length: 500 }, (_, i) => ({
    id: `m_${start + i}`,
    threadId: `t_${start + i}`,
  }));
  const nextToken = start + 500 < 2500 ? String(start / 500 + 1) : null;
  return { messages, nextPageToken: nextToken };
}

// SDK messages.get returns full metadata for a single message.
function gmailGetMessage(id: string) {
  return {
    id,
    threadId: `t_${id}`,
    internalDate: String(Date.now()),
    labelIds: ["INBOX"],
    snippet: `snippet ${id}`,
    payload: {
      headers: [
        { name: "Subject", value: `Subject ${id}` },
        { name: "From", value: `${id}@x.com` },
        { name: "To", value: "me@x.com" },
        { name: "Date", value: new Date().toUTCString() },
      ],
    },
  };
}

vi.mock("@/server/corsair", () => ({
  corsair: { withTenant: () => fakeClient },
  getConnectedCorsairPlugins: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  getSessionTenantId: vi.fn(() => Promise.resolve(TENANT)),
}));

vi.mock("@/server/db/mail-entities", () => ({
  listMessages: mockListMessages,
  listByLabel: mockListByLabel,
  countByLabel: mockCountByLabel,
  upsertManyByEntityIds: mockUpsert,
  getAccountIdForTenant: mockGetAccountId,
  getMailSyncState: mockGetMailSyncState,
  upsertMailSyncState: mockUpsertMailSyncState,
}));

function reset() {
  dbRows = [];
  syncState = null;
  listCallCount = 0;
  getMessageCallCount = 0;
  mockListMessages.mockReset();
  mockListByLabel.mockReset();
  mockCountByLabel.mockReset();
  mockFindManyByEntityIds.mockReset();
  mockUpsert.mockReset();
  mockGetAccountId.mockReset();
  mockGetMailSyncState.mockReset();
  mockUpsertMailSyncState.mockReset();
  mockApiMessagesList.mockReset();
  mockApiMessagesGet.mockReset();
  mockApiLabelsList.mockReset();
  mockDbLabelsList.mockReset();
  mockGetAccessToken.mockReset();

  mockGetAccountId.mockResolvedValue(ACCOUNT);
  mockGetAccessToken.mockResolvedValue("tok");
  // 5000 messages in the mailbox → count > 0 so backfill is triggered.
  mockDbLabelsList.mockResolvedValue([{ data: { id: "INBOX", messagesTotal: 5000 } }]);
  mockApiLabelsList.mockResolvedValue([]);
  mockCountByLabel.mockImplementation(async () => dbRows.length);

  // DB read simulates the persisted rows (offset/limit).
  mockListMessages.mockImplementation(async (_a, o) => {
    const off = o?.offset ?? 0;
    const lim = o?.limit ?? 25;
    return dbRows.slice(off, off + lim);
  });
  mockListByLabel.mockImplementation(async (_a, _l, o) => {
    const off = o?.offset ?? 0;
    const lim = o?.limit ?? 25;
    return dbRows.slice(off, off + lim);
  });

  // upsert appends/replaces rows in our in-memory DB.
  mockUpsert.mockImplementation(async (_a, items) => {
    for (const it of items) {
      const ex = dbRows.find((r) => r.data.id === it.entityId);
      if (ex) ex.data = { ...ex.data, ...it.data };
      else dbRows.push({ data: { id: it.entityId, ...it.data } });
    }
    return [];
  });

  // sync state mirrors the DB-backed helpers.
  mockGetMailSyncState.mockImplementation(async () =>
    syncState
      ? { accountId: ACCOUNT, viewKey: "l:INBOX", nextPageToken: syncState.nextPageToken, windowIndex: syncState.windowIndex, updatedAt: new Date() }
      : null,
  );
  mockUpsertMailSyncState.mockImplementation(async (_a, _vk, token, idx) => {
    syncState = { nextPageToken: token, windowIndex: idx };
  });

  // SDK messages.list: returns 500 IDs per window.
  mockApiMessagesList.mockImplementation(async (input: { pageToken?: string }) => {
    let token: string | null = input.pageToken ?? null;
    listCallCount++;
    return gmailWindow(token);
  });

  // SDK messages.get: returns full metadata for a single message.
  mockApiMessagesGet.mockImplementation(async (input: { id: string }) => {
    getMessageCallCount++;
    return gmailGetMessage(input.id);
  });
}

beforeEach(() => {
  vi.resetModules();
  reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("window backfill invariants", () => {
  it("refreshInbox (window 1) = 1 list call + 500 get calls (enrichment)", async () => {
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const res = await refreshInbox("INBOX", 1);

    expect(res.synced).toBe(500);
    expect(listCallCount).toBe(1); // exactly one messages.list
    expect(getMessageCallCount).toBe(500); // 500 messages.get for enrichment
    expect(dbRows).toHaveLength(500);
    expect(syncState?.nextPageToken).toBe("1");
    expect(syncState?.windowIndex).toBe(1);
  });

  it("page 21 triggers exactly one on-demand backfill then serves; re-read is instant", async () => {
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const { getMailList } = await import("@/server/mail");

    await refreshInbox("INBOX", 1); // window 1 (pages 1–20)
    expect(listCallCount).toBe(1);

    const r1 = await getMailList({ page: 21 });
    // One additional on-demand window (window 2) for page 21.
    expect(listCallCount).toBe(2);
    expect(r1.items).toHaveLength(25);
    expect(r1.page).toBe(21);
    expect(r1.hasMore).toBe(true);

    // Subsequent read of page 21 hits the DB cache, no new Gmail call.
    const prevListCalls = listCallCount;
    const r2 = await getMailList({ page: 21 });
    expect(listCallCount).toBe(prevListCalls);
    expect(r2.items).toHaveLength(25);
  });

  it("caps on-demand chaining at MAX_WINDOWS per request (no unbounded fan-out)", async () => {
    const { getMailList } = await import("@/server/mail");
    const { MAX_WINDOWS } = await import("@/server/mail/schemas");

    // Infinite mailbox: every window returns a nextPageToken, so without the
    // per-request cap the loop would never stop. Use a numeric window counter
    // so each window fetches distinct, valid rows.
    let wc = 0;
    mockApiMessagesList.mockImplementation(async (input: { pageToken?: string }) => {
      const start = wc * 500;
      wc++;
      listCallCount++;
      const messages = Array.from({ length: 500 }, (_, i) => ({
        id: `m_${start + i}`,
        threadId: `t_${start + i}`,
      }));
      return { messages, nextPageToken: String(wc) };
    });

    // An "infinite" mailbox: without the per-request cap the loop would never
    // stop. With MAX_WINDOWS=5 (2500 messages) it must stop after exactly 5
    // backfills even though more mail exists. MAX_PAGE clamps the request to
    // 100, which is exactly reachable within the cap, so the page is served.
    const r = await getMailList({ page: 100 });
    expect(listCallCount).toBe(MAX_WINDOWS);
    expect(r.items).toHaveLength(25);
    expect(r.page).toBe(100);
  });

  it("pages 1–20 read from DB with no Gmail call (window 1 only)", async () => {
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const { getMailList } = await import("@/server/mail");

    await refreshInbox("INBOX", 1);
    expect(listCallCount).toBe(1);

    for (let p = 1; p <= 20; p++) {
      const r = await getMailList({ page: p });
      expect(r.items).toHaveLength(25);
    }
    // No extra Gmail calls for cached pages.
    expect(listCallCount).toBe(1);
  });

  it("multi-window: pages 41–60 trigger windows 1+2+3 (1500 messages)", async () => {
    const { getMailList } = await import("@/server/mail");

    // Request page 50 — needs windows 1, 2, 3 (pages 1–75).
    const r = await getMailList({ page: 50 });
    expect(listCallCount).toBe(3); // 3 windows × 500 = 1500 messages
    expect(dbRows.length).toBe(1500);
    expect(r.items).toHaveLength(25);
    expect(r.page).toBe(50);
    expect(r.hasMore).toBe(true);
    expect(syncState?.nextPageToken).toBe("3");
  });

  it("multi-window: pages 81–100 trigger windows 1–5 (2500 messages, capped)", async () => {
    const { getMailList } = await import("@/server/mail");
    const { MAX_WINDOWS } = await import("@/server/mail/schemas");

    // Request page 100 — needs windows 1–5 (2500 messages = MAX_WINDOWS).
    const r = await getMailList({ page: 100 });
    expect(listCallCount).toBe(MAX_WINDOWS);
    expect(dbRows.length).toBe(MAX_WINDOWS * 500);
    expect(r.items).toHaveLength(25);
    expect(r.page).toBe(100);
  });

  it("backfill with zero messages from Gmail returns synced=0", async () => {
    mockApiMessagesList.mockResolvedValueOnce({ messages: [], nextPageToken: null });

    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const res = await refreshInbox("INBOX", 1);

    expect(res.synced).toBe(0);
    expect(dbRows).toHaveLength(0);
  });

  it("backfill persists nextPageToken; on-demand backfill chains windows", async () => {
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const { getMailList } = await import("@/server/mail");

    // Window 1 via refreshInbox — always starts from token null.
    await refreshInbox("INBOX", 1);
    expect(listCallCount).toBe(1);
    expect(syncState?.nextPageToken).toBe("1");
    expect(dbRows).toHaveLength(500);

    // On-demand backfill triggered by requesting page 25 (needs windows 1+2).
    // Window 1 already exists, so only window 2 is fetched = 2 total list calls.
    const r = await getMailList({ page: 25 });
    expect(listCallCount).toBe(2);
    expect(dbRows).toHaveLength(1000);
    expect(r.items).toHaveLength(25);
    expect(r.page).toBe(25);

    // Verify the second list call used pageToken "1" from syncState.
    const secondCall = mockApiMessagesList.mock.calls[1];
    expect(secondCall?.[0]?.pageToken).toBe("1");
  });
});
