import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ToolBackend } from "./tools.ts";
import { createServer } from "./server.ts";

/** Creates the server and connects it to stdio. Never returns in practice: stdin holds. */
export async function serveStdio(backend: ToolBackend, info: { name: string; version: string }): Promise<void> {
  const server: Server = createServer(backend, info);
  await server.connect(new StdioServerTransport());
}
