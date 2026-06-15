import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  extractBody,
  getHeader,
  getPartAttachments,
  toListItem,
  toMailMessage,
} from "@/server/mail/transformers";

describe("transformers", () => {
  describe("getHeader", () => {
    it("returns header value by case-insensitive name", () => {
      const headers = [
        { name: "Subject", value: "Hello" },
        { name: "From", value: "a@b.com" },
      ];
      expect(getHeader(headers, "subject")).toBe("Hello");
      expect(getHeader(headers, "FROM")).toBe("a@b.com");
    });

    it("returns undefined when header is missing", () => {
      expect(getHeader([], "subject")).toBeUndefined();
    });

    it("returns undefined when headers array is undefined", () => {
      expect(getHeader(undefined, "subject")).toBeUndefined();
    });

    it("returns undefined when header name property is missing", () => {
      const headers = [{ value: "hello" } as { name?: string; value?: string }];
      expect(getHeader(headers, "subject")).toBeUndefined();
    });
  });

  describe("decodeBase64Url", () => {
    it("decodes simple base64url string", () => {
      expect(decodeBase64Url("SGVsbG8gV29ybGQ=")).toBe("Hello World");
    });

    it("decodes base64url without padding", () => {
      expect(decodeBase64Url("SGVsbG8")).toBe("Hello");
    });

    it("returns empty string for undefined input", () => {
      expect(decodeBase64Url(undefined)).toBe("");
    });

    it("returns empty string for empty input", () => {
      expect(decodeBase64Url("")).toBe("");
    });

    it("replaces URL-safe dash with plus", () => {
      const standard = Buffer.from("hello-world").toString("base64");
      const urlSafe = standard.replace(/\+/g, "-").replace(/\//g, "_");
      expect(decodeBase64Url(urlSafe)).toBe("hello-world");
    });
  });

  describe("extractBody", () => {
    it("returns empty strings when payload is undefined", () => {
      expect(extractBody(undefined)).toEqual({ bodyHtml: "", bodyText: "" });
    });

    it("extracts HTML body from text/html part", () => {
      const html = Buffer.from("<p>Hello</p>").toString("base64");
      const payload = {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: Buffer.from("plain").toString("base64") } },
          { mimeType: "text/html", body: { data: html } },
        ],
      };
      const result = extractBody(payload);
      expect(result.bodyHtml).toBe("<p>Hello</p>");
      expect(result.bodyText).toBe("plain");
    });

    it("handles nested multipart payloads", () => {
      const html = Buffer.from("<div>nested</div>").toString("base64");
      const payload = {
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/html", body: { data: html } },
            ],
          },
        ],
      };
      const result = extractBody(payload);
      expect(result.bodyHtml).toBe("<div>nested</div>");
      expect(result.bodyText).toBe("");
    });

    it("ignores parts with missing data", () => {
      const payload = {
        mimeType: "text/plain",
        parts: [{ mimeType: "text/html", body: {} }],
      };
      const result = extractBody(payload);
      expect(result.bodyHtml).toBe("");
      expect(result.bodyText).toBe("");
    });

    it("prefers the first HTML and plain parts", () => {
      const html1 = Buffer.from("<p>first</p>").toString("base64");
      const html2 = Buffer.from("<p>second</p>").toString("base64");
      const payload = {
        parts: [
          { mimeType: "text/html", body: { data: html1 } },
          { mimeType: "text/html", body: { data: html2 } },
        ],
      };
      const result = extractBody(payload);
      expect(result.bodyHtml).toBe("<p>first</p>");
    });
  });

  describe("getPartAttachments", () => {
    it("returns empty array for undefined payload", () => {
      expect(getPartAttachments(undefined)).toEqual([]);
    });

    it("returns empty array when no parts", () => {
      expect(getPartAttachments({ parts: undefined })).toEqual([]);
    });

    it("extracts valid attachments", () => {
      const payload = {
        parts: [
          {
            filename: "doc.pdf",
            mimeType: "application/pdf",
            body: { size: 1024, attachmentId: "att_1" },
          },
        ],
      };
      const result = getPartAttachments(payload);
      expect(result).toEqual([
        {
          filename: "doc.pdf",
          mimeType: "application/pdf",
          size: 1024,
          attachmentId: "att_1",
        },
      ]);
    });

    it("skips inline attachments without attachmentId", () => {
      const payload = {
        parts: [
          {
            filename: "inline.png",
            mimeType: "image/png",
            body: {},
          },
        ],
      };
      expect(getPartAttachments(payload)).toEqual([]);
    });

    it("uses default mime type when mimeType is missing", () => {
      const payload = {
        parts: [
          {
            filename: "file.bin",
            body: { size: 0, attachmentId: "att_1" },
          },
        ],
      };
      const result = getPartAttachments(payload);
      expect(result[0].mimeType).toBe("application/octet-stream");
    });

    it("skips multipart container parts", () => {
      const payload = {
        parts: [
          {
            mimeType: "multipart/mixed",
            parts: [
              {
                filename: "inner.pdf",
                mimeType: "application/pdf",
                body: { size: 100, attachmentId: "att_inner" },
              },
            ],
          },
        ],
      };
      const result = getPartAttachments(payload);
      expect(result).toEqual([
        {
          filename: "inner.pdf",
          mimeType: "application/pdf",
          size: 100,
          attachmentId: "att_inner",
        },
      ]);
    });

    it("ignores empty filenames", () => {
      const payload = {
        parts: [
          {
            filename: "  ",
            mimeType: "text/plain",
            body: { size: 10, attachmentId: "att_1" },
          },
        ],
      };
      expect(getPartAttachments(payload)).toEqual([]);
    });
  });

  describe("toListItem", () => {
    it("transforms a valid row", () => {
      const row = {
        data: {
          id: "msg_1",
          threadId: "thread_1",
          subject: "Hello",
          from: "a@b.com",
          snippet: "Hi",
          internalDate: 1700000000000,
          labelIds: ["INBOX"],
          unread: true,
        },
      };
      const result = toListItem(row);
      expect(result.id).toBe("msg_1");
      expect(result.threadId).toBe("thread_1");
      expect(result.unread).toBe(true);
    });

    it("uses subject fallback to snippet", () => {
      const row = {
        data: {
          id: "1",
          internalDate: Date.now(),
          labelIds: [],
          snippet: "fallback",
          unread: false,
        },
      };
      const result = toListItem(row);
      expect(result.subject).toBe("fallback");
    });

    it("defaults missing fields to empty strings", () => {
      const row = {
        data: {
          id: "1",
          internalDate: Date.now(),
          labelIds: [],
          unread: false,
        },
      };
      const result = toListItem(row);
      expect(result.id).toBe("1");
      expect(result.threadId).toBe("");
      expect(result.subject).toBe("");
      expect(result.from).toBe("");
      expect(result.snippet).toBe("");
      expect(result.labelIds).toEqual([]);
    });

    it("handles internalDate as number string", () => {
      const row = {
        data: {
          id: "1",
          internalDate: "1700000000000",
          labelIds: [],
          unread: false,
        },
      };
      const result = toListItem(row);
      expect(result.receivedAt).toBe(new Date(Number("1700000000000")).toISOString());
    });
  });

  describe("toMailMessage", () => {
    const makeRow = (overrides: Record<string, unknown> = {}) => ({
      data: {
        id: "msg_1",
        threadId: "thread_1",
        snippet: "snippet",
        payload: {
          headers: [
            { name: "Subject", value: "Subject" },
            { name: "From", value: "from@example.com" },
            { name: "To", value: "to@example.com" },
            { name: "Cc", value: "cc@example.com" },
            { name: "Date", value: "Mon, 14 Jun 2026 15:00:00 +0530" },
          ],
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("plain").toString("base64") },
            },
            {
              mimeType: "text/html",
              body: { data: Buffer.from("<p>html</p>").toString("base64") },
            },
          ],
        },
        ...overrides,
      },
    });

    it("transforms a valid row", () => {
      const result = toMailMessage(makeRow().data);
      expect(result.id).toBe("msg_1");
      expect(result.subject).toBe("Subject");
      expect(result.from).toBe("from@example.com");
      expect(result.bodyHtml).toBe("<p>html</p>");
      expect(result.bodyText).toBe("plain");
    });

    it("uses fallback headers when payload headers are missing", () => {
      const result = toMailMessage(
        makeRow({
          subject: "Fallback",
          from: "fallback@example.com",
          payload: undefined,
        }).data,
      );
      expect(result.subject).toBe("Fallback");
      expect(result.from).toBe("fallback@example.com");
    });

    it("handles missing Cc header", () => {
      const result = toMailMessage(
        makeRow({
          payload: {
            headers: [
              { name: "Subject", value: "Subject" },
              { name: "From", value: "from@example.com" },
            ],
          },
        }).data,
      );
      expect(result.cc).toBe("");
    });

    it("handles missing payload gracefully", () => {
      const result = toMailMessage({
        id: "1",
        threadId: "t1",
        snippet: "snippet",
      });
      expect(result.id).toBe("1");
      expect(result.subject).toBe("");
      expect(result.cc).toBe("");
      expect(result.date).toBeNull();
      expect(result.bodyHtml).toBe("");
      expect(result.bodyText).toBe("");
      expect(result.attachments).toEqual([]);
    });

    it("extracts attachments from payload", () => {
      const result = toMailMessage(
        makeRow({
          payload: {
            headers: [],
            mimeType: "multipart/mixed",
            parts: [
              {
                filename: "doc.pdf",
                mimeType: "application/pdf",
                body: { size: 2048, attachmentId: "att_1" },
              },
            ],
          },
        }).data,
      );
      expect(result.attachments).toEqual([
        {
          filename: "doc.pdf",
          mimeType: "application/pdf",
          size: 2048,
          attachmentId: "att_1",
        },
      ]);
    });

    it("uses cached bodyHtml fallback when extraction yields empty string", () => {
      const result = toMailMessage(
        makeRow({
          bodyHtml: "<p>cached</p>",
          payload: {
            headers: [],
            mimeType: "text/plain",
            parts: [],
          },
        }).data,
      );
      expect(result.bodyHtml).toBe("<p>cached</p>");
      expect(result.bodyText).toBe("");
    });
  });
});
