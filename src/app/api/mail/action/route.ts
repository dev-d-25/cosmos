import { NextResponse } from "next/server";
import {
  archiveThread,
  trashThread,
  starThread,
  unstarThread,
  markAsUnread,
  markAsRead,
  deleteThread,
  moveToSpam,
} from "@/server/mail";
import { AuthMissingError } from "corsair/core";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, threadId, ids } = body as {
      action: string;
      threadId?: string;
      ids?: string[];
    };

    switch (action) {
      case "archive":
        if (!threadId) throw new Error("threadId required");
        await archiveThread(threadId);
        break;
      case "trash":
        if (!threadId) throw new Error("threadId required");
        await trashThread(threadId);
        break;
      case "star":
        if (!threadId) throw new Error("threadId required");
        await starThread(threadId);
        break;
      case "unstar":
        if (!threadId) throw new Error("threadId required");
        await unstarThread(threadId);
        break;
      case "markUnread":
        if (!ids?.length) throw new Error("ids required");
        await markAsUnread(ids);
        break;
      case "markRead":
        if (!ids?.length) throw new Error("ids required");
        await markAsRead(ids);
        break;
      case "spam":
        if (!threadId) throw new Error("threadId required");
        await moveToSpam(threadId);
        break;
      case "delete":
        if (!threadId) throw new Error("threadId required");
        await deleteThread(threadId);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
