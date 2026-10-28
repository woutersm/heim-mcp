import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serveTools, type PrepareCall } from "../server.ts";
import { prepareCall } from "../validate.ts";
import type { ToolBackend } from "../tools.ts";

/**
 * Joins a fresh server (named heim-mcp-eval) and client over an in-memory
 * transport pair and returns the connected client. Callers must close it.
 * `prepare` replaces heim-mcp's argument check; the eval's plain mode passes
 * `plainCall`.
 */
export async function connect(backend: ToolBackend, prepare: PrepareCall = prepareCall): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = serveTools(backend, { name: "heim-mcp-eval", version: "0.1.0" }, prepare);
  await server.connect(serverSide);
  const client = new Client({ name: "eval", version: "0.1.0" });
  await client.connect(clientSide);
  const clientClose = client.close.bind(client);
  client.close = async () => {
    await clientClose();
    await server.close();
  };
  return client;
}
