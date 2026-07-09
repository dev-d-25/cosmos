import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory simulation of the mail pipeline so we can assert the on-demand
// window-backfill invariants end-to-end without a real DB or Gmail.
type Row = { data: Record<string, unknown> };

const TENANT = "tenant_wb";
const ACCOUNT = "account_wb";

let dbRows: Row[] = [];
let syncState: { nextPageToken: string | null; windowIndex: number } | null = null;
let listCallCount = 0;
const getUrls: string[] = [];

const mockListMessages = vi.fn<(a: string, o?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockListByLabel = vi.fn<(a: string, l: string[], o?: { limit?: number; offset?: number }) => Promise<Row[]>>();
const mockCountByLabel = vi.fn<() => Promise<number>>();
const mockFindManyByEntityIds = vi.fn<(ids: string[]) => Promise<Row[]>>(() => Promise.resolve([]));
const mockUpsert = vi.fn<(a: string, items: Array<{ entityId: string; data: Record<string, unknown> }>) => Promise<Row[]>>();
const mockGetAccountId = vi.fn<() => Promise<string>>(() => Promise.resolve(ACCOUNT));
const mockGetMailSyncState = vi.fn<() => Promise<unknown>>();
const mockUpsertMailSyncState = vi.fn<(a: string, vk: string, token: string | null, idx: number) => Promise<void>>();
const mockApiMessagesList = vi.fn();
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
      messages: { list: mockApiMessagesList },
      labels: { list: mockApiLabelsList },
    },
    keys: { get_access_token: mockGetAccessToken },
  },
};

// Each Gmail `list` call returns 500 messages for the requested window and a
// nextPageToken (or null once we pass 2500 messages = MAX_WINDOWS * 500).
function gmailWindow(token: string | null) {
  const start = token ? Number(token) * 500 : 0;
  const messages = Array.from({ length: 500 }, (_, i) => ({
    id: `m_${start + i}`,
    threadId: `t_${start + i}`,
    internalDate: String(Date.now() - (start + i) * 1000),
    labelIds: ["INBOX"],
    payload: {
      headers: [
        { name: "Subject", value: `Subject ${start + i}` },
        { name: "From", value: `from${start + i}@x.com` },
        { name: "To", value: "me@x.com" },
        { name: "Date", value: new Date().toUTCString() },
      ],
    },
  }));
  const nextToken = start + 500 < 2500 ? String(start / 500 + 1) : null;
  return { messages, nextPageToken: nextToken };
}

const mockFetch = vi.fn<(url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<{ messages: unknown[]; nextPageToken: string | null }> }>>();

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
  getUrls.length = 0;
  mockListMessages.mockReset();
  mockListByLabel.mockReset();
  mockCountByLabel.mockReset();
  mockFindManyByEntityIds.mockReset();
  mockUpsert.mockReset();
  mockGetAccountId.mockReset();
  mockGetMailSyncState.mockReset();
  mockUpsertMailSyncState.mockReset();
  mockApiMessagesList.mockReset();
  mockApiLabelsList.mockReset();
  mockDbLabelsList.mockReset();
  mockGetAccessToken.mockReset();
  mockFetch.mockReset();

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

  // Gmail list: exactly one call per window, returns 500 messages, 0 gets.
  mockFetch.mockImplementation(async (url: string) => {
    const u = String(url);
    if (/\/messages\/[^?]/.test(u)) getUrls.push(u); // a per-message GET
    let token: string | null = null;
    const m = /[?&]pageToken=([^&]+)/.exec(u);
    if (m) token = m[1] ?? null;
    listCallCount++;
    return {
      ok: true,
      status: 200,
      json: async () => gmailWindow(token),
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  reset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("window backfill invariants", () => {
  it("refreshInbox (window 1) = exactly 1 list call, 0 per-message gets", async () => {
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");
    const res = await refreshInbox("INBOX", 1);

    expect(res.synced).toBe(500);
    expect(listCallCount).toBe(1); // exactly one list(format=metadata,500)
    expect(getUrls).toHaveLength(0); // zero per-message gets
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
    expect(getUrls).toHaveLength(0);
    expect(r1.items).toHaveLength(25);
    expect(r1.page).toBe(21);
    expect(r1.hasMore).toBe(true);

    // Subsequent read of page 21 hits the DB cache, no new Gmail call.
    const r2 = await getMailList({ page: 21 });
    expect(listCallCount).toBe(2);
    expect(r2.items).toHaveLength(25);
  });

  it("caps on-demand chaining at MAX_WINDOWS (no unbounded fan-out)", async () => {
    const { getMailList } = await import("@/server/mail");
    const { MAX_WINDOWS } = await import("@/server/mail/schemas");

    // Pretend we've already walked MAX_WINDOWS windows.
    syncState = { nextPageToken: String(MAX_WINDOWS), windowIndex: MAX_WINDOWS };

    const r = await getMailList({ page: 99 });
    // Loop breaks immediately: no backfill, empty page.
    expect(listCallCount).toBe(0);
    expect(getUrls).toHaveLength(0);
    expect(r.items).toHaveLength(0);
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
    expect(getUrls).toHaveLength(0);
  });
});
