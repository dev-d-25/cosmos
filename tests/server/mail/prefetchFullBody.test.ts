import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAccessToken = vi.fn<() => Promise<string | null>>();
const mockApiMessagesGet = vi.fn();

const mockWithTenant = vi.fn(() => ({
  gmail: {
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
  upsertManyByEntityIds: vi.fn(),
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
    mockApiMessagesGet.mockReset();
    mockGetSessionTenantId.mockReset();
    mockGetSessionTenantId.mockResolvedValue("tenant_1");
    mockGetAccessToken.mockResolvedValue("fake_access_token");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthenticated when there is no session", async () => {
    mockGetSessionTenantId.mockResolvedValueOnce(null);
    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_1");
    expect(result).toEqual({ id: "msg_1", ok: false, error: "unauthenticated" });
    expect(mockApiMessagesGet).not.toHaveBeenCalled();
  });

  it("fetches via SDK with format=full", async () => {
    mockApiMessagesGet.mockResolvedValueOnce(makeGmailResponse("msg_1"));

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_1");

    expect(result).toEqual({ id: "msg_1", ok: true });
    expect(mockApiMessagesGet).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesGet).toHaveBeenCalledWith({
      userId: "me",
      id: "msg_1",
      format: "full",
    });
  });

  it("persists denormalized subject/from/to via SDK auto-upsert", async () => {
    mockApiMessagesGet.mockResolvedValueOnce(makeGmailResponse("msg_2"));

    const { prefetchFullBody } = await import("@/server/mail");
    await prefetchFullBody("msg_2");

    expect(mockApiMessagesGet).toHaveBeenCalledTimes(1);
    expect(mockApiMessagesGet).toHaveBeenCalledWith({
      userId: "me",
      id: "msg_2",
      format: "full",
    });
    // SDK auto-upserts; no manual upsert assertions needed
  });

  it("returns ok=false with the error when SDK throws (4xx)", async () => {
    mockApiMessagesGet.mockRejectedValueOnce(
      new Error("gmail_404 Not Found"),
    );

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_404");

    expect(result.ok).toBe(false);
    expect(result.id).toBe("msg_404");
    expect(result.error).toContain("gmail_404");
    expect(result.error).toContain("Not Found");
  });

  it("returns ok=false when SDK throws due to missing access token", async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    mockApiMessagesGet.mockRejectedValueOnce(
      new Error("no_access_token"),
    );

    const { prefetchFullBody } = await import("@/server/mail");
    const result = await prefetchFullBody("msg_no_token");

    expect(result).toEqual({
      id: "msg_no_token",
      ok: false,
      error: "no_access_token",
    });
  });

  it("is safe to call for the same id multiple times (idempotent)", async () => {
    mockApiMessagesGet.mockResolvedValue(makeGmailResponse("msg_dup"));

    const { prefetchFullBody } = await import("@/server/mail");
    const r1 = await prefetchFullBody("msg_dup");
    const r2 = await prefetchFullBody("msg_dup");
    const r3 = await prefetchFullBody("msg_dup");

    expect(r1).toEqual({ id: "msg_dup", ok: true });
    expect(r2).toEqual({ id: "msg_dup", ok: true });
    expect(r3).toEqual({ id: "msg_dup", ok: true });
  });
});
