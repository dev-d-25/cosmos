import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSessionTenantId = vi.fn<() => Promise<string | null>>();
const mockGetAccountIdForTenant = vi.fn<() => Promise<string>>();
const mockApiMessagesList = vi.fn();
const mockApiLabelsList = vi.fn();
const mockGetAccessToken = vi.fn<() => Promise<string | null>>();
const mockUpsertMailSyncState = vi.fn<() => Promise<void>>();
const mockFetch = vi.fn<() => Promise<{ ok: boolean; status: number; json: () => Promise<{ messages: unknown[] }> }>>();

const TENANT = "tenant_refresh_test";

const fakeClient = {
  gmail: {
    api: {
      messages: { list: mockApiMessagesList },
      labels: { list: mockApiLabelsList },
    },
    keys: { get_access_token: mockGetAccessToken },
  },
};

vi.mock("@/server/corsair", () => ({
  corsair: { withTenant: () => fakeClient },
  getConnectedCorsairPlugins: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  getSessionTenantId: mockGetSessionTenantId,
}));

vi.mock("@/server/db/mail-entities", () => ({
  getAccountIdForTenant: mockGetAccountIdForTenant,
  upsertMailSyncState: mockUpsertMailSyncState,
}));

describe("mail-background-sync", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetSessionTenantId.mockReset();
    mockGetAccountIdForTenant.mockReset();
    mockApiMessagesList.mockReset();
    mockApiLabelsList.mockReset();
    mockGetAccessToken.mockReset();
    mockFetch.mockReset();

    mockGetSessionTenantId.mockResolvedValue(TENANT);
    mockGetAccountIdForTenant.mockResolvedValue("account_refresh");
    mockGetAccessToken.mockResolvedValue("fake_access_token");
    // Empty Gmail list → backfillWindow does exactly 1 list call, 0 gets.
    mockApiMessagesList.mockResolvedValue({ messages: [] });
    mockApiLabelsList.mockResolvedValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [], nextPageToken: null }),
    });
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("invalidates the tenant's list cache before and after a refresh", async () => {
    const { setMailListCache, checkMailListCache, getMailListCacheKey } =
      await import("@/server/mail/mail-page-cache");
    const { refreshInbox } = await import("@/server/mail/mail-background-sync");

    const key = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    setMailListCache(key, {
      items: [],
      count: 5,
      page: 1,
      totalPages: 1,
      hasMore: false,
      hasPrev: false,
      cacheState: "full",
      coverage: 1,
      source: "cache",
      degraded: false,
    });
    expect(checkMailListCache(key)).toBeDefined();

    const result = await refreshInbox("INBOX", 1);

    expect(result).toEqual({ synced: 0 });
    // The cached entry must be gone after refreshInbox ran its invalidations.
    expect(checkMailListCache(key)).toBeUndefined();
  });
});
