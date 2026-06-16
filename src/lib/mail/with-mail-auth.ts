import { NextResponse } from "next/server";
import { AuthMissingError } from "corsair/core";
import { getSessionTenantId } from "@/server/auth";
import { z } from "zod";

type RouteHandler = (request: Request) => Promise<Response>;

export function withMailAuth(handler: RouteHandler) {
  return async function handleRequest(request: Request) {
    const tenantId = await getSessionTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof AuthMissingError) {
        return NextResponse.json(
          { error: "gmail_not_connected" },
          { status: 409 },
        );
      }
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid response", details: err.issues },
          { status: 500 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
