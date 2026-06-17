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
  console.log("[corsair-tools] Creating MCP server for tenant:", tenantId);
  const tenantClient = corsair.withTenant(tenantId);
  const server = createBaseMcpServer({ corsair: tenantClient, tenantId });
  console.log("[corsair-tools] MCP server created (tenant-scoped)");

  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();

  console.log("[corsair-tools] Connecting MCP server...");
  await server.connect(serverTransport);
  console.log("[corsair-tools] MCP server connected");

  console.log("[corsair-tools] Creating MCP client...");
  const client = await createMCPClient({
    name: "cosmos-chat-client",
    version: "0.1.0",
    transport: clientTransport,
  });
  console.log("[corsair-tools] MCP client created");

  console.log("[corsair-tools] Fetching tools from MCP server...");
  const tools = await client.tools();
  console.log(
    "[corsair-tools] Tools fetched:",
    Object.keys(tools),
  );

  return { client, tools };
}
