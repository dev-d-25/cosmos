import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getSessionTenantId, initiateOAuth } from "@/server/connected-account";

export async function GET(request: NextRequest) {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plugin = request.nextUrl.searchParams.get("plugin");
  if (!plugin) {
    return NextResponse.json({ error: "Missing plugin param" }, { status: 400 });
  }

  const { url, state } = await initiateOAuth(tenantId, plugin);

  const response = NextResponse.redirect(url);
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
  });
  return response;
}
