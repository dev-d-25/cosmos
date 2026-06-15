import { NextResponse } from "next/server";
import { sendEmail, replyToMessage, forwardMessage } from "@/server/mail";
import { AuthMissingError } from "corsair/core";
import type { MimeAttachment } from "@/server/mail/mime";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    switch (action) {
      case "send": {
        const { to, cc, bcc, subject, html, text, threadId, inReplyTo, references, attachments } = body as {
          to: string[];
          cc?: string[];
          bcc?: string[];
          subject: string;
          html?: string;
          text?: string;
          threadId?: string;
          inReplyTo?: string;
          references?: string;
          attachments?: { filename: string; mimeType: string; data: string }[];
        };
        const result = await sendEmail({
          to,
          cc,
          bcc,
          subject,
          html,
          text,
          threadId,
          inReplyTo,
          references,
          attachments: attachments as MimeAttachment[] | undefined,
        });
        return NextResponse.json(result);
      }
      case "reply": {
        const { messageId, body: replyBody, replyAll, isHtml } = body as {
          messageId: string;
          body: string;
          replyAll?: boolean;
          isHtml?: boolean;
        };
        const result = await replyToMessage(messageId, replyBody, {
          replyAll,
          html: isHtml !== false,
        });
        return NextResponse.json(result);
      }
      case "forward": {
        const { messageId, to, body: fwdBody } = body as {
          messageId: string;
          to: string[];
          body?: string;
        };
        const result = await forwardMessage(messageId, to, fwdBody);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json({ error: "gmail_not_connected" }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
