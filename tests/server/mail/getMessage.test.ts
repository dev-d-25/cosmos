import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  data: Record<string, unknown>;
};

const mockFindByEntityId = vi.fn<(id: string) => Promise<Row | null>>();
const mockGetAccessToken = vi.fn<() => Promise<string | null>>();
const mockUpsertManyByEntityIds = vi.fn();

const mockApiMessagesGet = vi.fn();

const mockWithTenant = vi.fn(() => ({
  gmail: {
    db: {
      messages: {
        findByEntityId: mockFindByEntityId,
      },
    },
    keys: {
      get_access_token: mockGetAccessToken,
    },
    api: {
      messages: {
        get: mockApiMessagesGet,
      },
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

function makeMultipartPayload(): Record<string, unknown> {
  const text = Buffer.from("plain body").toString("base64");
  const html = Buffer.from("<p>html body</p>").toString("base64");
  return {
    mimeType: "multipart/alternative",
    headers: [
      { name: "Subject", value: "Security alert" },
      { name: "From", value: "Google <no-reply@accounts.google.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Date", value: "Fri, 19 Jun 2026 10:18:32 GMT" },
    ],
    parts: [
      { mimeType: "text/plain", body: { data: text } },
      { mimeType: "text/html", body: { data: html } },
    ],
  };
}

describe("getMessage", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFindByEntityId.mockReset();
    mockGetAccessToken.mockReset();
    mockUpsertManyByEntityIds.mockReset();
    mockApiMessagesGet.mockReset();
    mockGetSessionTenantId.mockReset();
    mockGetSessionTenantId.mockResolvedValue("tenant_1");
    mockGetAccessToken.mockResolvedValue("fake_access_token");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when there is no session", async () => {
    mockGetSessionTenantId.mockResolvedValueOnce(null);
    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_1");
    expect(result).toBeNull();
    expect(mockFindByEntityId).not.toHaveBeenCalled();
  });

  it("returns from cache when the cached row has parts with body data", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_1",
        payload: makeMultipartPayload(),
      },
    });

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_1");

    expect(result).not.toBeNull();
    expect(result?.source).toBe("cache");
    expect(mockApiMessagesGet).not.toHaveBeenCalled();
    expect(mockUpsertManyByEntityIds).not.toHaveBeenCalled();
  });

  it("returns from cache when the cached row has a top-level body.data", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_2",
        payload: {
          mimeType: "text/plain",
          body: {
            data: Buffer.from("simple body").toString("base64"),
          },
        },
      },
    });

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_2");

    expect(result?.source).toBe("cache");
    expect(mockApiMessagesGet).not.toHaveBeenCalled();
  });

  /**
   * Regression: the "Security alert" / Google messages were 400'ing on
   * click because they had no `subject`/`from` denormalized fields when
   * the row was first prefetched by the SDK. The fix in fetchAndPersistFullBody
   * was to denormalize them on persist. This test covers the cache-hit path
   * for that exact shape.
   */
  it("returns from cache for a row persisted by fetchAndPersistFullBody (denormalized fields)", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_3",
        threadId: "msg_3",
        subject: "Security alert",
        from: "Google <no-reply@accounts.google.com>",
        to: "me@example.com",
        payload: makeMultipartPayload(),
      },
    });

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_3");

    expect(result?.source).toBe("cache");
    // Critical: no live fetch, no SDK auto-persist 3-query upsert
    expect(mockApiMessagesGet).not.toHaveBeenCalled();
    expect(mockUpsertManyByEntityIds).not.toHaveBeenCalled();
  });

  /**
   * Regression: the "body-as-object" bug. fetchAndPersistFullBody used
   * to store `body: raw.payload` (the entire payload object) which then
   * failed the corsair SDK's entity schema (`body: z.string().optional()`)
   * on every read, surfacing as 400 "Invalid request" on click. The fix
   * removed that line; this test confirms the read path does not throw
   * for rows that have a body-as-object (the 44 rows that were cleaned
   * up by scripts/fix-body-as-object.ts after the fix).
   */
  it("does not throw when the cached row has a body-as-object (legacy from broken prefetch)", async () => {
    // Simulate the legacy bad shape: body is an object, not a string
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_legacy",
        threadId: "msg_legacy",
        subject: "Legacy",
        from: "x@y.com",
        payload: makeMultipartPayload(),
        body: makeMultipartPayload(), // <-- the bug: object instead of string
      },
    });

    const { getMessage } = await import("@/server/mail");
    // The function itself doesn't throw; the SDK would throw on read
    // (which is what was causing the 400 in the route). We test the
    // getMessage happy path here — it returns cache. The real fix is
    // in the route handler (query schema) and the cleanup script.
    const result = await getMessage("msg_legacy");
    expect(result?.source).toBe("cache");
  });

  it("forces a live fetch when force=true, bypassing cache", async () => {
    // Cache has data, but force=true should skip it
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_4",
        payload: makeMultipartPayload(),
      },
    });
    mockApiMessagesGet.mockResolvedValueOnce({
      id: "msg_4",
      threadId: "msg_4",
      payload: {
        headers: [{ name: "Subject", value: "Forced" }],
        mimeType: "text/plain",
        body: { data: Buffer.from("forced").toString("base64") },
      },
    });

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_4", { force: true });

    expect(result?.source).toBe("live");
    expect(mockFindByEntityId).not.toHaveBeenCalled();
    // SDK messages.get is called (it auto-upserts to DB internally)
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "msg_4", format: "full" }),
    );
  });

  it("falls back to live fetch when cache row has no body data (metadata only)", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: {
        id: "msg_5",
        subject: "Metadata only",
        from: "x@y.com",
        // No payload — just metadata from format=metadata enrichment
      },
    });
    mockApiMessagesGet.mockResolvedValueOnce({
      id: "msg_5",
      threadId: "msg_5",
      payload: makeMultipartPayload(),
    });

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_5");

    expect(result?.source).toBe("live");
    // SDK messages.get is called (it auto-upserts to DB internally)
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "msg_5", format: "full" }),
    );
  });

  it("fetches via SDK messages.get(format=full) when cache has no body", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: { id: "msg_6" },
    });
    const fetched = {
      id: "msg_6",
      threadId: "msg_6",
      labelIds: ["INBOX", "UNREAD"],
      internalDate: "1730000000000",
      snippet: "snip",
      payload: makeMultipartPayload(),
    };
    mockApiMessagesGet.mockResolvedValueOnce(fetched);

    const { getMessage } = await import("@/server/mail");
    const result = await getMessage("msg_6");

    expect(result?.source).toBe("live");
    expect(result?.message).toEqual(fetched);
    // SDK messages.get is called with format=full (auto-upserts to DB)
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesGet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "msg_6", format: "full" }),
    );
  });

  it("propagates errors from SDK messages.get (e.g. auth failure)", async () => {
    mockFindByEntityId.mockResolvedValueOnce({
      data: { id: "msg_7" }, // no body → triggers live fetch
    });
    mockApiMessagesGet.mockRejectedValueOnce(new Error("no_access_token"));

    const { getMessage } = await import("@/server/mail");
    // SDK messages.get throws. getMessage does not catch its
    // own errors; the route catches and returns 500.
    await expect(getMessage("msg_7")).rejects.toThrow("no_access_token");
  });
});
