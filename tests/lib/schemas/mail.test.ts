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
} from "@/lib/schemas/mail";

describe("Mail schemas", () => {
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

    it("rejects non-date receivedAt", () => {
      const result = MailListItemSchema.safeParse({
        id: "1",
        threadId: "t1",
        subject: "",
        from: "",
        snippet: "",
        receivedAt: "not-a-date",
        unread: false,
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
    };

    it("accepts a valid message", () => {
      const result = MailMessageSchema.parse(validMessage);
      expect(result.id).toBe("msg_1");
    });

    it("rejects attachments with extra keys", () => {
      const result = MailMessageSchema.safeParse({
        ...validMessage,
        attachments: [{ extra: true }],
      });
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
      };
      const result = MailProfileSchema.parse(input);
      expect(result.emailAddress).toBe("me@gmail.com");
    });

    it("rejects invalid cachedAt", () => {
      const result = MailProfileSchema.safeParse({
        emailAddress: "me@gmail.com",
        messagesTotal: 0,
        threadsTotal: 0,
        historyId: "0",
        cachedAt: "now",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MailListResponseSchema", () => {
    it("accepts valid response with items", () => {
      const input = {
        items: [],
        nextPageToken: null,
        source: "live",
      };
      const result = MailListResponseSchema.parse(input);
      expect(result.source).toBe("live");
    });

    it("rejects invalid source", () => {
      const result = MailListResponseSchema.safeParse({
        items: [],
        nextPageToken: null,
        source: "invalid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("MailThreadsQuerySchema", () => {
    it("parses default values when omitted", () => {
      const result = MailThreadsQuerySchema.parse({});
      expect(result.page).toBe(0);
      expect(result.pageSize).toBe(50);
      expect(result.refresh).toBe("false");
      expect(result.token).toBeUndefined();
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

    it("rejects invalid refresh value", () => {
      const result = MailThreadsQuerySchema.safeParse({ refresh: "yes" });
      expect(result.success).toBe(false);
    });
  });

  describe("MailMessageQuerySchema", () => {
    it("parses default refresh false", () => {
      const result = MailMessageQuerySchema.parse({});
      expect(result.refresh).toBe("false");
    });

    it("accepts refresh true", () => {
      const result = MailMessageQuerySchema.parse({ refresh: "true" });
      expect(result.refresh).toBe("true");
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
