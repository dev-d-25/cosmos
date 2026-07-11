"use server";

import { z } from "zod";

import { getMailList } from "./mail-list";
import { getMessage } from "./mail-messages";
import { applyThreadAction, type ThreadActionName } from "./thread-actions";
import { sendEmail, replyToMessage, forwardMessage } from "./mail-send";
import { createDraft, updateDraft, deleteDraft } from "./mail-drafts";
import { MailListResponseSchema } from "./schemas";
import type { MailListResponse } from "./schemas";

// ─── Shared types ──────────────────────────────────────────────────

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

// ─── Input schemas ─────────────────────────────────────────────────

const ThreadActionSchema = z.object({
  action: z.enum(["archive", "trash", "star", "unstar", "spam", "delete", "markRead", "markUnread"]),
  threadId: z.string().optional(),
  ids: z.array(z.string()).optional(),
});

const SendSchema = z.object({
  to: z.array(z.string()),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string(),
  html: z.string().optional(),
  text: z.string().optional(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  attachments: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    data: z.string(),
  })).optional(),
});

const ReplySchema = z.object({
  messageId: z.string(),
  body: z.string(),
  replyAll: z.boolean().optional(),
  isHtml: z.boolean().optional(),
});

const ForwardSchema = z.object({
  messageId: z.string(),
  to: z.array(z.string()),
  body: z.string().optional(),
});

const DraftCreateSchema = z.object({
  to: z.string().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string().optional(),
  html: z.string().optional(),
});

const DraftUpdateSchema = DraftCreateSchema.extend({
  draftId: z.string(),
});

const DraftDeleteSchema = z.object({
  draftId: z.string(),
});

// ─── Thread action dispatch ────────────────────────────────────────

export async function dispatchThreadAction(
  action: string,
  body: Record<string, unknown>,
): Promise<ActionResult> {
  const parsed = ThreadActionSchema.safeParse({ ...body, action });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
  }
  const { action: name, threadId, ids } = parsed.data;

  if (name === "markRead" || name === "markUnread") {
    if (!ids?.length) return { ok: false, error: "ids required", status: 400 };
  } else if (!threadId) {
    return { ok: false, error: "threadId required", status: 400 };
  }

  try {
    await applyThreadAction(name, { threadId, ids });
    return { ok: true, data: undefined };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Send action dispatch ──────────────────────────────────────────

export async function dispatchSendAction(
  action: string,
  body: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  try {
    switch (action) {
      case "send": {
        const parsed = SendSchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await sendEmail(parsed.data);
        return { ok: true, data: result };
      }
      case "reply": {
        const parsed = ReplySchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await replyToMessage(parsed.data.messageId, parsed.data.body, {
          replyAll: parsed.data.replyAll,
          html: parsed.data.isHtml !== false,
        });
        return { ok: true, data: result };
      }
      case "forward": {
        const parsed = ForwardSchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await forwardMessage(parsed.data.messageId, parsed.data.to, parsed.data.body);
        return { ok: true, data: result };
      }
      default:
        return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Draft action dispatch ─────────────────────────────────────────

export async function dispatchDraftAction(
  action: string,
  body: Record<string, unknown>,
): Promise<ActionResult<unknown>> {
  try {
    switch (action) {
      case "create": {
        const parsed = DraftCreateSchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await createDraft(parsed.data);
        return { ok: true, data: result };
      }
      case "update": {
        const parsed = DraftUpdateSchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await updateDraft(parsed.data.draftId, {
          to: parsed.data.to,
          cc: parsed.data.cc,
          bcc: parsed.data.bcc,
          subject: parsed.data.subject,
          html: parsed.data.html,
        });
        return { ok: true, data: result };
      }
      case "delete": {
        const parsed = DraftDeleteSchema.safeParse(body);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input", status: 400 };
        }
        const result = await deleteDraft(parsed.data.draftId);
        return { ok: true, data: result };
      }
      default:
        return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Queries ───────────────────────────────────────────────────────

export async function getThreadList(params: {
  page: number;
  labelIds?: string[];
  q?: string;
}): Promise<ActionResult<MailListResponse>> {
  try {
    const data = await getMailList(params);
    const validated = MailListResponseSchema.parse(data);
    return { ok: true, data: validated };
  } catch (err) {
    return normalizeError(err);
  }
}

export async function getMessageById(
  id: string,
  opts?: { force?: boolean },
): Promise<ActionResult<{ message: unknown; source: "cache" | "live" } | null>> {
  try {
    const data = await getMessage(id, opts);
    return { ok: true, data };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Error normalization ───────────────────────────────────────────

function normalizeError(err: unknown): ActionResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message, status: 500 };
}
