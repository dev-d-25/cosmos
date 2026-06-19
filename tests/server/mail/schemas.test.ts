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
} from "@/server/mail/schemas";

/**
 * These tests cover the LIVE schema file consumed by the route handlers
 * (src/server/mail/schemas.ts). The old duplicate at
 * src/lib/schemas/mail.ts was dead code (no callers) and has been
 * removed; do not resurrect it.
 */
describe("Mail schemas (live)", () => {
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

  describe("MailListResponseSchema", () => {
    it("accepts valid response with items", () => {
      const input = {
        items: [],
        nextPageToken: null,
        source: "live",
        totalCount: 0,
      };
      const result = MailListResponseSchema.parse(input);
      expect(result.source).toBe("live");
    });

    it("rejects invalid source", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        nextPageToken: null,
        source: "invalid",
        totalCount: 0,
      });
      expect(result.success).toBe(false);
    });
  });

  /**
   * Regression: the query schema used to be `z.enum(["true", "false"])`
   * which threw 400 on `?refresh=` (empty). The fix relaxed it to
   * `z.string().optional()` so any value passes through to the
   * `query.refresh === "true"` check in the route.
   */
  describe("MailThreadsQuerySchema", () => {
    it("parses default values when omitted", () => {
      const result = MailThreadsQuerySchema.parse({});
      expect(result.page).toBe(0);
      expect(result.pageSize).toBe(50);
      expect(result.token).toBeUndefined();
      expect(result.refresh).toBeUndefined();
    });

    it("rejects negative page", () => {
      const result = MailThreadsQuerySchema.safeParse({ page: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer page", () => {
      const result = MailThreadsQuerySchema.safeParse({ page: 1.5 });
      expect(result.success).toBe(false);
    });

    it("rejects pageSize above max", () => {
      const result = MailThreadsQuerySchema.safeParse({ pageSize: 500 });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive pageSize", () => {
      const result = MailThreadsQuerySchema.safeParse({ pageSize: 0 });
      expect(result.success).toBe(false);
    });

    it("accepts page, pageSize, token, refresh true", () => {
      const result = MailThreadsQuerySchema.parse({
        page: 2,
        pageSize: 20,
        token: "abc123",
        refresh: "true",
      });
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(20);
      expect(result.token).toBe("abc123");
      expect(result.refresh).toBe("true");
    });

    it("accepts any refresh string (relaxed from strict enum)", () => {
      // The old strict-enum behavior rejected "yes", "", or any non-true/false
      // value with 400. The fix accepts any string and the route does the
      // boolean coercion with `query.refresh === "true"`.
      expect(MailThreadsQuerySchema.parse({ refresh: "yes" }).refresh).toBe("yes");
      expect(MailThreadsQuerySchema.parse({ refresh: "" }).refresh).toBe("");
    });
  });

  /**
   * Regression: this is the schema that caused the "Invalid request" 400
   * on click when the SDK validation pipeline threw. See notes above.
   */
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
      // Regression: the old `z.enum(["true","false"])` threw ZodError on "".
      const result = MailMessageQuerySchema.parse({ refresh: "" });
      expect(result.refresh).toBe("");
    });

    it("accepts arbitrary refresh string (no enum)", () => {
      const result = MailMessageQuerySchema.parse({ refresh: "garbage" });
      expect(result.refresh).toBe("garbage");
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
