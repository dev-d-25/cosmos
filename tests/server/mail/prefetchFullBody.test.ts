import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAccessToken = vi.fn<() => Promise<string | null>>();
const mockUpsertManyByEntityIds = vi.fn();

const mockFetch = vi.fn();

const mockWithTenant = vi.fn(() => ({
  gmail: {
    keys: {
      get_access_token: mockGetAccessToken,
    },
  },
}));

const mockGetSessionTenantId = vi.fn<() => Promise<string | null>>();

vi.mock("@/server/corsair", () => ({
  corsair: { withTenant: mockWithTenant },
}));

vi.mock("@/server/auth", () => ({
  getSessionTenantId: mockGetSessionTenantId,
}));

vi.mock("@/server/db/mail-entities", () => ({
  upsertManyByEntityIds: mockUpsertManyByEntityIds,
  getAccountIdForTenant: vi.fn().mockResolvedValue("account_1"),
}));

function makeGmailResponse(id: string) {
  return {
    id,
    threadId: id,
    labelIds: ["INBOX", "UNREAD"],
    internalDate: "1730000000000",
    snippet: "snip",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: `Subject ${id}` },
        { name: "From", value: `${id}@example.com` },
        { name: "To", value: "me@example.com" },
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: { data: Buffer.from(`body ${id}`).toString("base64") },
        },
      ],
    },
  };
}

describe("prefetchFullBody", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetAccessToken.mockReset();
    mockUpsertManyByEntityIds.mockReset();
    mockFetch.mockReset();
    mockGetSessionTenantId.mockReset();
    mockGetSessionTenantId.mockResolvedValue("tenant_1");
    mockGetAccessToken.mockResolvedValue("fake_access_token");
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns unauthenticated when there is no session", async () => {
    mockGetSessionTenantId.mockResolvedValueOnce(null);
    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_1");
    expect(result).toEqual({ id: "msg_1", ok: false, error: "unauthenticated" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockUpsertManyByEntityIds).not.toHaveBeenCalled();
  });

  it("fetches with format=full and persists via native upsert", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeGmailResponse("msg_1"),
    });

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_1");

    expect(result).toEqual({ id: "msg_1", ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toContain("messages/msg_1");
    expect(url).toContain("format=full");
    expect(init.headers.Authorization).toBe("Bearer fake_access_token");
    expect(mockUpsertManyByEntityIds).toHaveBeenCalledTimes(1);
  });

  it("persists denormalized subject/from/to so the next read hits cache cleanly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeGmailResponse("msg_2"),
    });

    const { prefetchFullBody } = await import("@/server/mail");
    await prefetchFullBody("msg_2");

    const [_accountId, items] = mockUpsertManyByEntityIds.mock.calls[0]!;
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.entityId).toBe("msg_2");
    // The next getMessage() cache check looks at these fields + payload
    expect(item.data.subject).toBe("Subject msg_2");
    expect(item.data.from).toBe("msg_2@example.com");
    expect(item.data.to).toBe("me@example.com");
    // No body-as-object (the regression)
    expect(item.data.body).toBeUndefined();
    expect(item.data.payload).toBeDefined();
  });

  it("returns ok=false with the error when Gmail returns 4xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    });

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_404");

    expect(result.ok).toBe(false);
    expect(result.id).toBe("msg_404");
    expect(result.error).toContain("gmail_404");
    expect(result.error).toContain("Not Found");
    expect(mockUpsertManyByEntityIds).not.toHaveBeenCalled();
  });

  it("returns ok=false when there is no access token", async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_no_token");

    expect(result).toEqual({
      id: "msg_no_token",
      ok: false,
      error: "no_access_token",
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is safe to call for the same id multiple times (idempotent)", async () => {
    // The intersection-based dedup at the MailListRow level is what
    // actually prevents duplicate prefetches. This test confirms that
    // the server action itself is idempotent — same id, same result.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeGmailResponse("msg_dup"),
    });

    const { prefetchFullBody } = await import("@/server/mail");
    const r1 = await prefetchFullBody("msg_dup");
    const r2 = await prefetchFullBody("msg_dup");
    const r3 = await prefetchFullBody("msg_dup");

    expect(r1).toEqual({ id: "msg_dup", ok: true });
    expect(r2).toEqual({ id: "msg_dup", ok: true });
    expect(r3).toEqual({ id: "msg_dup", ok: true });
  });
});
