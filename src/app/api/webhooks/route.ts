import { eq } from "drizzle-orm";

import { processWebhook } from "corsair";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionTenantId } from "@/server/auth";
import { corsair } from "@/server/corsair";
import { db } from "@/server/db";
import { user } from "@/server/db/schema";

const DEFAULT_TENANT_ID = "default";

type RawBody = string | Record<string, unknown>;

function extractEmail(body: RawBody): string | null {
	if (typeof body !== "object" || body === null) return null;
	const message = (body as { message?: { data?: string } }).message;
	if (!message?.data) return null;
	try {
		const decoded = JSON.parse(
			Buffer.from(message.data, "base64").toString("utf-8"),
		) as { emailAddress?: string };
		return decoded.emailAddress ?? null;
	} catch {
		return null;
	}
}

async function resolveTenantId(
	email: string | null,
	fallback: string,
): Promise<string> {
	if (!email) return fallback;
	const row = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row[0]?.id ?? fallback;
}

export async function POST(request: NextRequest) {
	const headers: Record<string, string> = {};
	request.headers.forEach((value, key) => {
		headers[key] = value;
	});

	const contentType = request.headers.get("content-type");
	let body: RawBody;

	if (contentType?.includes("application/json")) {
		body = (await request.json()) as RawBody;
	} else {
		const text = await request.text();
		body = text && text.trim() ? text : {};
	}

	const fallbackTenant = (await getSessionTenantId()) ?? DEFAULT_TENANT_ID;
	const email = extractEmail(body);
	const tenantId = await resolveTenantId(email, fallbackTenant);

	if (email) {
		console.info("[webhook] gmail push", { email, tenantId });
	}

	const result = await processWebhook(corsair, headers, body, { tenantId });

	console.info("[webhook] processed", {
		plugin: result.plugin,
		action: result.action,
		tenantId,
	});

	const responseHeaders = new Headers();
	if (result.responseHeaders) {
		for (const [key, value] of Object.entries(result.responseHeaders)) {
			responseHeaders.set(key, value);
		}
	}

	if (!result.response) {
		return NextResponse.json(
			{ success: false, message: "No matching webhook handler found" },
			{ status: 404, headers: responseHeaders },
		);
	}

	return NextResponse.json(result.response, { headers: responseHeaders });
}

export async function GET() {
	return NextResponse.json({
		status: "ok",
		message: "Webhook endpoint is active",
		timestamp: new Date().toISOString(),
	});
}
