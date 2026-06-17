import { randomUUID } from "crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { createBaseMcpServer } from "@corsair-dev/mcp";

import { getSessionTenantId } from "@/server/auth";
import { corsair } from "@/server/corsair";

type Session = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

const sessions = new Map<string, Session>();

function cleanup(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  void session.transport.close();
  void session.server.close();
}

async function createSession(tenantId: string): Promise<Session> {
  const server = createBaseMcpServer({
    corsair: corsair as unknown as { [key: string]: unknown },
    tenantId,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id: string) => {
      sessions.set(id, { server, transport });
    },
    onsessionclosed: (id: string) => cleanup(id),
  });
  await server.connect(transport);
  return { server, transport };
}

async function handle(request: Request): Promise<Response> {
  const tenantId = await getSessionTenantId();
  if (!tenantId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sessionId = request.headers.get("mcp-session-id") ?? undefined;

  if (request.method === "DELETE") {
    if (sessionId) cleanup(sessionId);
    return new Response(null, { status: 200 });
  }

  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (!existing) {
      return new Response("Session not found", { status: 404 });
    }
    return existing.transport.handleRequest(request);
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST, DELETE" },
    });
  }

  const session = await createSession(tenantId);
  return session.transport.handleRequest(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
