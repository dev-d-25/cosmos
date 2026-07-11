import { beforeEach, describe, expect, it } from "vitest";
import {
  getMailListCacheKey,
  checkMailListCache,
  setMailListCache,
  invalidateMailListCacheForTenant,
} from "@/server/mail/mail-page-cache";
import type { MailListResponse } from "@/server/mail/schemas";

const TENANT = "tenant_cache_test";

function makeResponse(overrides: Partial<MailListResponse> = {}): MailListResponse {
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
    ...overrides,
  };
}

describe("mail-page-cache", () => {
  beforeEach(() => {
    // Start each test from a clean slate for this tenant.
    invalidateMailListCacheForTenant(TENANT);
  });

  it("builds a stable, deterministic key from tenant + view + page", () => {
    const a = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    const b = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    const c = getMailListCacheKey(TENANT, { labelIds: ["STARRED"] }, 1);
    const d = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 2);
    const e = getMailListCacheKey("other", { labelIds: ["INBOX"] }, 1);

    expect(a).toBe(b); // identical inputs → identical key
    expect(a).not.toBe(c); // different label → different key
    expect(a).not.toBe(d); // different page → different key
    expect(a).not.toBe(e); // different tenant → different key
    expect(a).toContain(TENANT);
  });

  it("sorts labelIds so key order is independent of input order", () => {
    const a = getMailListCacheKey(TENANT, { labelIds: ["INBOX", "STARRED"] }, 1);
    const b = getMailListCacheKey(TENANT, { labelIds: ["STARRED", "INBOX"] }, 1);
    expect(a).toBe(b);
  });

  it("round-trips a set value through check (no Gmail calls)", () => {
    const key = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    expect(checkMailListCache(key)).toBeUndefined();

    const resp = makeResponse({ count: 25, cacheState: "full", coverage: 1 });
    setMailListCache(key, resp);

    const hit = checkMailListCache(key);
    expect(hit).toBe(resp); // identical reference, not a copy
  });

  it("invalidates every page for a tenant", () => {
    const k1 = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    const k2 = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 2);
    setMailListCache(k1, makeResponse());
    setMailListCache(k2, makeResponse());

    invalidateMailListCacheForTenant(TENANT);

    expect(checkMailListCache(k1)).toBeUndefined();
    expect(checkMailListCache(k2)).toBeUndefined();
  });

  it("invalidates only the given view when a view is supplied", () => {
    const inboxKey = getMailListCacheKey(TENANT, { labelIds: ["INBOX"] }, 1);
    const starredKey = getMailListCacheKey(TENANT, { labelIds: ["STARRED"] }, 1);
    const inboxResp = makeResponse();
    const starredResp = makeResponse();
    setMailListCache(inboxKey, inboxResp);
    setMailListCache(starredKey, starredResp);

    invalidateMailListCacheForTenant(TENANT, { labelIds: ["INBOX"] });

    expect(checkMailListCache(inboxKey)).toBeUndefined();
    expect(checkMailListCache(starredKey)).toBe(starredResp); // untouched
  });

  it("does not leak across tenants", () => {
    const otherKey = getMailListCacheKey("other_tenant", { labelIds: ["INBOX"] }, 1);
    const otherResp = makeResponse();
    setMailListCache(otherKey, otherResp);

    invalidateMailListCacheForTenant(TENANT);

    expect(checkMailListCache(otherKey)).toBe(otherResp);
  });
});
