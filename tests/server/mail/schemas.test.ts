import { describe, expect, it } from "vitest";
import {
  GetProfileApiResponseSchema,
  InboxRefreshResponseSchema,
  MailAttachmentSchema,
  MailLabelSchema,
  MailListResponseSchema,
  MailListItemSchema,
  MailMessageSchema,
  MailMessageQuerySchema,
  MailProfileSchema,
  MailThreadsQuerySchema,
  PAGE_SIZE,
} from "@/server/mail/schemas";

/**
 * These tests cover the LIVE schema file consumed by the route handlers
 * (src/server/mail/schemas.ts). The old duplicate at
 * src/lib/schemas/mail.ts was dead code (no callers) and has been
 * removed; do not resurrect it.
 */
describe("Mail schemas (live)", () => {
  describe("PAGE_SIZE", () => {
    it("is exported as 25 (the single page size constant for SSR, client, schema, cache key)", () => {
      expect(PAGE_SIZE).toBe(25);
    });
  });

  describe("MailAttachmentSchema", () => {
    it("accepts a valid attachment", () => {
      const input = {
        filename: "test.pdf",
        mimeType: "application/pdf",
        size: 1024,
        attachmentId: "att_123",
      };
      const result = MailAttachmentSchema.parse(input);
      expect(result).toEqual(input);
    });

    it("rejects missing required fields", () => {
      expect(() => MailAttachmentSchema.parse({})).toThrow();
    });

    it("rejects null attachment id", () => {
      const result = MailAttachmentSchema.safeParse({
        filename: "x",
        mimeType: "application/pdf",
        size: 0,
        attachmentId: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MailListItemSchema", () => {
    it("accepts a valid list item", () => {
      const input = {
        id: "msg_1",
        threadId: "thread_1",
        subject: "Hello",
        from: "a@b.com",
        snippet: "Hi",
        receivedAt: new Date().toISOString(),
        unread: false,
        labelIds: ["INBOX"],
      };
      const result = MailListItemSchema.parse(input);
      expect(result.threadId).toBe("thread_1");
    });

    it("accepts optional subject/from/snippet (defaults to undefined)", () => {
      const result = MailListItemSchema.parse({
        id: "1",
        threadId: "t1",
        receivedAt: new Date().toISOString(),
        unread: false,
        labelIds: [],
      });
      expect(result.subject).toBeUndefined();
      expect(result.from).toBeUndefined();
      expect(result.snippet).toBeUndefined();
    });

    it("rejects missing unread", () => {
      const result = MailListItemSchema.safeParse({
        id: "1",
        threadId: "t1",
        subject: "",
        from: "",
        snippet: "",
        receivedAt: new Date().toISOString(),
        labelIds: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MailMessageSchema", () => {
    const validMessage = {
      id: "msg_1",
      threadId: "thread_1",
      subject: "Hello",
      from: "a@b.com",
      to: "c@d.com",
      cc: "e@f.com",
      date: "Mon, 14 Jun 2026 15:00:00 +0530",
      snippet: "Body",
      bodyHtml: "<p>html</p>",
      bodyText: "text",
      attachments: [],
      inlineImages: [],
    };

    it("accepts a valid message", () => {
      const result = MailMessageSchema.parse(validMessage);
      expect(result.id).toBe("msg_1");
    });

    it("defaults all optional fields to safe values when missing", () => {
      const result = MailMessageSchema.parse({ id: "msg_2" });
      expect(result.threadId).toBe("");
      expect(result.subject).toBe("");
      expect(result.from).toBe("");
      expect(result.to).toBe("");
      expect(result.cc).toBe("");
      expect(result.date).toBeNull();
      expect(result.snippet).toBe("");
      expect(result.bodyHtml).toBe("");
      expect(result.bodyText).toBe("");
      expect(result.attachments).toEqual([]);
      expect(result.inlineImages).toEqual([]);
    });

    it("accepts null date", () => {
      const result = MailMessageSchema.parse({ id: "1", date: null });
      expect(result.date).toBeNull();
    });

    it("rejects attachments with extra keys", () => {
      const result = MailMessageSchema.safeParse({
        ...validMessage,
        attachments: [{ extra: true }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing id (id is required)", () => {
      const result = MailMessageSchema.safeParse({ subject: "no id" });
      expect(result.success).toBe(false);
    });
  });

  describe("MailLabelSchema", () => {
    it("accepts a valid label", () => {
      const input = {
        id: "label_1",
        name: "Inbox",
        type: "system",
        messagesTotal: 100,
        messagesUnread: 5,
        color: "#fff",
      };
      const result = MailLabelSchema.parse(input);
      expect(result.type).toBe("system");
    });

    it("rejects invalid type", () => {
      const result = MailLabelSchema.safeParse({
        id: "label_1",
        name: "Inbox",
        type: "custom",
        messagesTotal: 0,
        messagesUnread: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative messagesUnread", () => {
      const result = MailLabelSchema.safeParse({
        id: "label_1",
        name: "Inbox",
        type: "system",
        messagesTotal: 0,
        messagesUnread: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MailProfileSchema", () => {
    it("accepts a valid profile", () => {
      const input = {
        emailAddress: "me@gmail.com",
        messagesTotal: 100,
        threadsTotal: 50,
        historyId: "12345",
        cachedAt: new Date().toISOString(),
        name: "Me",
        picture: "https://example.com/p.png",
      };
      const result = MailProfileSchema.parse(input);
      expect(result.emailAddress).toBe("me@gmail.com");
    });

    it("accepts minimal profile (only required field)", () => {
      const result = MailProfileSchema.parse({});
      expect(result.emailAddress).toBe("");
      expect(result.messagesTotal).toBe(0);
      expect(result.threadsTotal).toBe(0);
      expect(result.historyId).toBe("");
    });
  });

  describe("MailListResponseSchema (v2 contract)", () => {
    it("accepts a valid response with items, count, and pagination fields", () => {
      const input = {
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
      };
      const result = MailListResponseSchema.parse(input);
      expect(result.source).toBe("cache");
      expect(result.cacheState).toBe("empty");
    });

    it("accepts null count for free-text search (no exact count available)", () => {
      const input = {
        items: [],
        count: null,
        page: 1,
        totalPages: null,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1,
        source: "live",
        degraded: false,
      };
      const result = MailListResponseSchema.parse(input);
      expect(result.count).toBeNull();
      expect(result.totalPages).toBeNull();
    });

    it("rejects negative count", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        count: -1,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1,
        source: "cache",
        degraded: false,
      });
      expect(result.success).toBe(false);
    });

    it("rejects coverage outside [0, 1]", () => {
      const tooHigh = MailListResponseSchema.safeParse({
        items: [],
        count: 10,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1.5,
        source: "cache",
        degraded: false,
      });
      expect(tooHigh.success).toBe(false);

      const tooLow = MailListResponseSchema.safeParse({
        items: [],
        count: 10,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: -0.1,
        source: "cache",
        degraded: false,
      });
      expect(tooLow.success).toBe(false);
    });

    it("rejects invalid cacheState", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        count: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "loading",
        coverage: 0,
        source: "cache",
        degraded: false,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid source", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        count: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1,
        source: "websocket",
        degraded: false,
      });
      expect(result.success).toBe(false);
    });

    it("accepts 'syncing' as a source (partial cache + background fill)", () => {
      const result = MailListResponseSchema.parse({
        items: [],
        count: 50,
        page: 1,
        totalPages: 2,
        hasMore: true,
        hasPrev: false,
        cacheState: "partial",
        coverage: 0.5,
        source: "syncing",
        degraded: false,
      });
      expect(result.source).toBe("syncing");
    });

    it("rejects page=0 (pages are 1-based)", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        count: 0,
        page: 0,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1,
        source: "cache",
        degraded: false,
      });
      expect(result.success).toBe(false);
    });

    it("does not include legacy nextPageToken or totalCount fields", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        nextPageToken: "cache:1", // legacy field
        totalCount: 0, // legacy field
        count: 0,
        page: 1,
        totalPages: 1,
        hasMore: false,
        hasPrev: false,
        cacheState: "full",
        coverage: 1,
        source: "cache",
        degraded: false,
      });
      expect(result.success).toBe(true);
      // z.object strips unknown keys by default
      expect((result.data as { nextPageToken?: unknown }).nextPageToken).toBeUndefined();
      expect((result.data as { totalCount?: unknown }).totalCount).toBeUndefined();
    });
  });

  /**
   * MailThreadsQuerySchema no longer accepts pageSize from the client —
   * PAGE_SIZE is the single constant. Page is 1-based.
   */
  describe("MailThreadsQuerySchema", () => {
    it("parses default values when omitted", () => {
      const result = MailThreadsQuerySchema.parse({});
      expect(result.page).toBe(1);
      expect(result.token).toBeUndefined();
      expect(result.labelIds).toBeUndefined();
      expect(result.q).toBeUndefined();
    });

    it("rejects page=0 (1-based externally)", () => {
      const result = MailThreadsQuerySchema.safeParse({ page: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative page", () => {
      const result = MailThreadsQuerySchema.safeParse({ page: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer page", () => {
      const result = MailThreadsQuerySchema.safeParse({ page: 1.5 });
      expect(result.success).toBe(false);
    });

    it("does not include pageSize (it's a server constant now)", () => {
      const result = MailThreadsQuerySchema.parse({});
      expect((result as { pageSize?: unknown }).pageSize).toBeUndefined();
    });

    it("accepts labelIds as a string array", () => {
      const result = MailThreadsQuerySchema.parse({ labelIds: ["STARRED"] });
      expect(result.labelIds).toEqual(["STARRED"]);
    });

    it("accepts q (search)", () => {
      const result = MailThreadsQuerySchema.parse({ q: "from:alice" });
      expect(result.q).toBe("from:alice");
    });
  });

  describe("MailMessageQuerySchema", () => {
    it("returns undefined refresh when omitted", () => {
      const result = MailMessageQuerySchema.parse({});
      expect(result.refresh).toBeUndefined();
    });

    it("accepts refresh true (route will force-fetch)", () => {
      const result = MailMessageQuerySchema.parse({ refresh: "true" });
      expect(result.refresh).toBe("true");
    });

    it("accepts empty refresh string without throwing", () => {
      const result = MailMessageQuerySchema.parse({ refresh: "" });
      expect(result.refresh).toBe("");
    });
  });

  describe("GetProfileApiResponseSchema", () => {
    it("parses default values for missing fields", () => {
      const result = GetProfileApiResponseSchema.parse({});
      expect(result.emailAddress).toBe("");
      expect(result.messagesTotal).toBe(0);
      expect(result.threadsTotal).toBe(0);
      expect(result.historyId).toBe("");
    });

    it("accepts a valid profile response", () => {
      const result = GetProfileApiResponseSchema.parse({
        emailAddress: "a@b.com",
        messagesTotal: 10,
        threadsTotal: 5,
        historyId: "123",
      });
      expect(result.emailAddress).toBe("a@b.com");
    });
  });

  describe("InboxRefreshResponseSchema", () => {
    it("accepts valid response", () => {
      const result = InboxRefreshResponseSchema.parse({ synced: 0 });
      expect(result.synced).toBe(0);
    });

    it("rejects negative synced count", () => {
      const result = InboxRefreshResponseSchema.safeParse({ synced: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer synced count", () => {
      const result = InboxRefreshResponseSchema.safeParse({ synced: 1.5 });
      expect(result.success).toBe(false);
    });
  });
});
