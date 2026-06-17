import "server-only";

import { createMCPClient } from "@ai-sdk/mcp";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { createBaseMcpServer } from "@corsair-dev/mcp";
import type { ToolSet } from "ai";

import { corsair } from "@/server/corsair";

export type CorsairToolsHandle = {
  client: Awaited<ReturnType<typeof createMCPClient>>;
  tools: ToolSet;
};

/**
 * Build a fresh MCP server + client pair for a given tenant and return the
 * Vercel-AI-SDK tool set. The handle owns the client; the caller MUST call
 * `handle.client.close()` when done (e.g. in the request cleanup hook).
 */
export async function getCorsairToolsForTenant(
  tenantId: string,
): Promise<CorsairToolsHandle> {
  const server = createBaseMcpServer({ corsair, tenantId });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = await createMCPClient({
    name: "cosmos-chat-client",
    version: "0.1.0",
    transport: clientTransport,
  });

  const tools = await client.tools();

  return { client, tools };
}
