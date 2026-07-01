"use server";

import { AuthMissingError } from "corsair/core";
import { z } from "zod";

import { getMailList, getMessage } from "@/server/mail";
import {
  archiveThread,
  trashThread,
  starThread,
  unstarThread,
  markAsUnread,
  markAsRead,
  moveToSpam,
  deleteThread,
} from "@/server/mail";
import { sendEmail, replyToMessage, forwardMessage } from "@/server/mail";
import { createDraft, updateDraft, deleteDraft } from "@/server/mail";
import { MailListResponseSchema, type MailListResponse } from "@/server/mail/schemas";
import type { MimeAttachment } from "@/server/mail/mime";

// ─── Error normalization ────────────────────────────────────────────

type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

function normalizeError(err: unknown): CommandResult<never> {
  if (err instanceof AuthMissingError) {
    return { ok: false, error: "gmail_not_connected", status: 409 };
  }
  if (err instanceof z.ZodError) {
    return { ok: false, error: "Invalid response", status: 500 };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message, status: 500 };
}

// ─── Thread actions ─────────────────────────────────────────────────

const ACTIONS: Record<string, string> = {
  archive: "archive",
  trash: "trash",
  star: "star",
  unstar: "unstar",
  spam: "spam",
  delete: "delete",
  markRead: "markRead",
  markUnread: "markUnread",
};

export async function dispatchThreadAction(
  action: string,
  body: Record<string, unknown>,
): Promise<CommandResult<void>> {
  const name = ACTIONS[action];
  if (!name) return { ok: false, error: `Unknown action: ${action}`, status: 400 };
  try {
    switch (name) {
      case "archive":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await archiveThread(body.threadId);
        break;
      case "trash":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await trashThread(body.threadId);
        break;
      case "star":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await starThread(body.threadId);
        break;
      case "unstar":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await unstarThread(body.threadId);
        break;
      case "spam":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await moveToSpam(body.threadId);
        break;
      case "delete":
        if (!body.threadId || typeof body.threadId !== "string") return { ok: false, error: "threadId required", status: 400 };
        await deleteThread(body.threadId);
        break;
      case "markRead":
        if (!Array.isArray(body.ids) || body.ids.length === 0) return { ok: false, error: "ids required", status: 400 };
        await markAsRead(body.ids as string[]);
        break;
      case "markUnread":
        if (!Array.isArray(body.ids) || body.ids.length === 0) return { ok: false, error: "ids required", status: 400 };
        await markAsUnread(body.ids as string[]);
        break;
    }
    return { ok: true, data: undefined };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Send actions ───────────────────────────────────────────────────

export async function dispatchSendAction(
  action: string,
  body: Record<string, unknown>,
): Promise<CommandResult<unknown>> {
  try {
    let result: unknown;
    switch (action) {
      case "send": {
        result = await sendEmail({
          to: Array.isArray(body.to) ? body.to as string[] : [],
          cc: Array.isArray(body.cc) ? body.cc as string[] : undefined,
          bcc: Array.isArray(body.bcc) ? body.bcc as string[] : undefined,
          subject: typeof body.subject === "string" ? body.subject : "",
          html: typeof body.html === "string" ? body.html : undefined,
          text: typeof body.text === "string" ? body.text : undefined,
          threadId: typeof body.threadId === "string" ? body.threadId : undefined,
          inReplyTo: typeof body.inReplyTo === "string" ? body.inReplyTo : undefined,
          references: typeof body.references === "string" ? body.references : undefined,
          attachments: Array.isArray(body.attachments) ? body.attachments as MimeAttachment[] : undefined,
        });
        break;
      }
      case "reply": {
        result = await replyToMessage(
          typeof body.messageId === "string" ? body.messageId : "",
          typeof body.body === "string" ? body.body : "",
          {
            replyAll: typeof body.replyAll === "boolean" ? body.replyAll : undefined,
            html: (body.isHtml as boolean) !== false,
          },
        );
        break;
      }
      case "forward": {
        result = await forwardMessage(
          typeof body.messageId === "string" ? body.messageId : "",
          Array.isArray(body.to) ? body.to as string[] : [],
          typeof body.body === "string" ? body.body : undefined,
        );
        break;
      }
      default:
        return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
    return { ok: true, data: result };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Draft actions ──────────────────────────────────────────────────

export async function dispatchDraftAction(
  action: string,
  body: Record<string, unknown>,
): Promise<CommandResult<unknown>> {
  try {
    let result: unknown;
    switch (action) {
      case "create": {
        result = await createDraft({
          to: typeof body.to === "string" ? body.to : "",
          cc: typeof body.cc === "string" ? body.cc : "",
          bcc: typeof body.bcc === "string" ? body.bcc : "",
          subject: typeof body.subject === "string" ? body.subject : "",
          html: typeof body.html === "string" ? body.html : "",
        });
        break;
      }
      case "update": {
        if (!body.draftId || typeof body.draftId !== "string") return { ok: false, error: "draftId required", status: 400 };
        result = await updateDraft(body.draftId as string, {
          to: typeof body.to === "string" ? body.to : "",
          cc: typeof body.cc === "string" ? body.cc : "",
          bcc: typeof body.bcc === "string" ? body.bcc : "",
          subject: typeof body.subject === "string" ? body.subject : "",
          html: typeof body.html === "string" ? body.html : "",
        });
        break;
      }
      case "delete": {
        if (!body.draftId || typeof body.draftId !== "string") return { ok: false, error: "draftId required", status: 400 };
        result = await deleteDraft(body.draftId as string);
        break;
      }
      default:
        return { ok: false, error: `Unknown action: ${action}`, status: 400 };
    }
    return { ok: true, data: result };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Thread list ────────────────────────────────────────────────────

export async function getThreadList(params: {
  page: number;
  labelIds?: string[];
  q?: string;
}): Promise<CommandResult<MailListResponse>> {
  try {
    const data = await getMailList(params);
    const validated = MailListResponseSchema.parse(data);
    return { ok: true, data: validated };
  } catch (err) {
    return normalizeError(err);
  }
}

// ─── Single message ─────────────────────────────────────────────────

export async function getMessageById(
  id: string,
  opts?: { force?: boolean },
): Promise<CommandResult<{ message: unknown; source: "cache" | "live" } | null>> {
  try {
    const data = await getMessage(id, opts);
    return { ok: true, data };
  } catch (err) {
    return normalizeError(err);
  }
}