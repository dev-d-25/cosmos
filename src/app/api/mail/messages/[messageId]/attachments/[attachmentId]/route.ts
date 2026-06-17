import { NextResponse } from "next/server";
import { getAttachmentContent } from "@/server/mail";
import { AuthMissingError } from "corsair/core";

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{ messageId: string; attachmentId: string }>;
  },
) {
  try {
    const { messageId, attachmentId } = await params;
    const url = new URL(_req.url);
    const filename = url.searchParams.get("filename") ?? "attachment";
    const mimeType = url.searchParams.get("mimeType") ?? "application/octet-stream";

    const result = await getAttachmentContent(messageId, attachmentId);
    if (!result.ok) {
      const status =
        result.status === 401 || result.status === 403 ? 404 : result.status >= 500 ? 502 : 404;
      return NextResponse.json(
        {
          error: "Attachment not found",
          detail: result.error,
          upstreamStatus: result.status,
        },
        { status },
      );
    }

    const normalized = result.data
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const pad = normalized.length % 4;
    const padded = normalized + "=".repeat(pad === 0 ? 0 : 4 - pad);
    const buffer = Buffer.from(padded, "base64");

    const sanitizedFilename = filename.replace(/[^\w.\-/\\]/g, "_");
    const isImage = mimeType.startsWith("image/");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${sanitizedFilename}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof AuthMissingError) {
      return NextResponse.json(
        { error: "gmail_not_connected" },
        { status: 409 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
