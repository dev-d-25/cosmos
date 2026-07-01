import { NextResponse } from "next/server";
import { applyThreadAction, type ThreadActionName } from "@/server/mail/thread-actions";
import { AuthMissingError } from "corsair/core";

const ACTIONS: Record<string, ThreadActionName> = {
  archive: "archive", trash: "trash", star: "star", unstar: "unstar",
  spam: "spam", delete: "delete",
  markRead: "markRead", markUnread: "markUnread",
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };
    const name = ACTIONS[action];
    if (!name) return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    await applyThreadAction(name, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
