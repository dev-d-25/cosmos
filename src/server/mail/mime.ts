/**
 * MIME message builder for Gmail API.
 * Constructs RFC 2822 emails and base64url-encodes them for corsair's messages.send.
 */

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: string; // base64-encoded content
}

export interface MimeMessageOptions {
  from?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: MimeAttachment[];
  headers?: Record<string, string>;
  boundary?: string;
}

function generateBoundary(): string {
  return `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function encodeHeaderValue(value: string): string {
  // Fold long header lines per RFC 2822 (max 78 chars per line)
  if (value.length <= 78) return value;
  const words = value.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine.length + word.length + 1 > 78) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.join("\r\n ");
}

function buildHeaders(options: MimeMessageOptions, boundary?: string): string {
  const lines: string[] = [];

  if (options.from) {
    lines.push(`From: ${options.from}`);
  }
  if (options.to.length > 0) {
    lines.push(`To: ${options.to.join(", ")}`);
  }
  if (options.cc && options.cc.length > 0) {
    lines.push(`Cc: ${options.cc.join(", ")}`);
  }
  if (options.bcc && options.bcc.length > 0) {
    lines.push(`Bcc: ${options.bcc.join(", ")}`);
  }
  lines.push(`Subject: ${encodeHeaderValue(options.subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push("MIME-Version: 1.0");

  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (value) {
        lines.push(`${key}: ${value}`);
      }
    }
  }

  const hasAttachments = options.attachments && options.attachments.length > 0;
  const hasHtml = !!options.html;
  const hasText = !!options.text;

  if (hasAttachments) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  } else if (hasHtml && hasText) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  } else if (hasHtml) {
    lines.push("Content-Type: text/html; charset=utf-8");
  } else {
    lines.push("Content-Type: text/plain; charset=utf-8");
  }

  return lines.join("\r\n");
}

function buildTextPart(text: string, boundary: string): string {
  return `\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
}

function buildHtmlPart(html: string, boundary: string): string {
  return `\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`;
}

function buildAttachmentPart(attachment: MimeAttachment, boundary: string): string {
  return `\r\n--${boundary}\r\nContent-Type: ${attachment.mimeType}; name="${attachment.filename}"\r\nContent-Disposition: attachment; filename="${attachment.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment.data}`;
}

/**
 * Build a raw MIME message string from options.
 */
export function buildMimeMessage(options: MimeMessageOptions): string {
  const hasAttachments = options.attachments && options.attachments.length > 0;
  const hasHtml = !!options.html;
  const hasText = !!options.text;

  const boundary = options.boundary || generateBoundary();
  const headers = buildHeaders(options, hasAttachments || (hasHtml && hasText) ? boundary : undefined);

  // Simple case: only text or only html, no attachments
  if (!hasAttachments && !(hasHtml && hasText)) {
    const body = hasHtml ? options.html! : options.text || "";
    return `${headers}\r\n\r\n${body}`;
  }

  // Multipart: build parts
  const parts: string[] = [];

  if (hasHtml && hasText) {
    // multipart/alternative inside multipart/mixed (if attachments)
    if (hasAttachments) {
      const altBoundary = generateBoundary();
      parts.push(`\r\n--${boundary}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"`);
      parts.push(buildTextPart(options.text!, altBoundary));
      parts.push(buildHtmlPart(options.html!, altBoundary));
      parts.push(`\r\n--${altBoundary}--`);
    } else {
      parts.push(buildTextPart(options.text!, boundary));
      parts.push(buildHtmlPart(options.html!, boundary));
    }
  } else if (hasHtml) {
    if (hasAttachments) {
      parts.push(buildHtmlPart(options.html!, boundary));
    } else {
      // Already handled above
    }
  } else if (hasText) {
    if (hasAttachments) {
      parts.push(buildTextPart(options.text!, boundary));
    }
  }

  // Add attachments
  if (hasAttachments) {
    for (const attachment of options.attachments!) {
      parts.push(buildAttachmentPart(attachment, boundary));
    }
  }

  return `${headers}${parts.join("")}\r\n--${boundary}--`;
}

/**
 * Encode a MIME message string to base64url for Gmail API.
 */
export function encodeBase64Url(mimeString: string): string {
  const base64 = Buffer.from(mimeString, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build and encode a MIME message for Gmail API in one step.
 */
export function buildEncodedMimeMessage(options: MimeMessageOptions): string {
  const raw = buildMimeMessage(options);
  return encodeBase64Url(raw);
}

/**
 * Build a reply MIME message with proper threading headers.
 */
export function buildReplyMimeMessage(options: {
  from?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  inReplyTo: string;
  references: string;
  threadId?: string;
  attachments?: MimeAttachment[];
}): string {
  return buildEncodedMimeMessage({
    from: options.from,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    html: options.html,
    text: options.text,
    attachments: options.attachments,
    headers: {
      "In-Reply-To": options.inReplyTo,
      References: options.references,
    },
  });
}

/**
 * Build a forward MIME message.
 */
export function buildForwardMimeMessage(options: {
  from?: string;
  to: string[];
  cc?: string[];
  subject: string;
  html?: string;
  text?: string;
  originalFrom: string;
  originalDate: string;
  originalSubject: string;
  originalTo: string;
  originalBody: string;
  attachments?: MimeAttachment[];
}): string {
  const forwardedHeader = [
    "---------- Forwarded message ----------",
    `From: ${options.originalFrom}`,
    `Date: ${options.originalDate}`,
    `Subject: ${options.originalSubject}`,
    `To: ${options.originalTo}`,
    "",
    "",
  ].join("\r\n");

  const html = options.html
    ? `${options.html}<br><br>${forwardedHeader.replace(/\r\n/g, "<br>")}<br>${options.originalBody}`
    : undefined;

  const text = options.text
    ? `${options.text}\n\n${forwardedHeader}\n${options.originalBody}`
    : `${forwardedHeader}\n${options.originalBody}`;

  return buildEncodedMimeMessage({
    from: options.from,
    to: options.to,
    cc: options.cc,
    subject: options.subject,
    html,
    text,
    attachments: options.attachments,
  });
}

/**
 * Extract email address from a "Name <email>" string.
 */
export function extractEmail(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return match?.[1] ?? address.trim();
}

/**
 * Extract display name from a "Name <email>" string.
 */
export function extractName(address: string): string {
  const match = address.match(/^"?([^"<]+)"?\s*</);
  return match?.[1]?.trim() ?? "";
}

/**
 * Parse a comma-separated list of email addresses.
 */
export function parseEmailList(value: string): string[] {
  return value
    .split(",")
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}
