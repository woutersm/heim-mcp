import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Protocol } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { assertFlat, prepareCall } from "./validate.ts";
import { ToolError, type ToolAnnotations, type ToolBackend, type ToolDef } from "./tools.ts";

/** The text every model-readable failure is returned as. */
function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

/** Turns what a model sent into a tool's arguments and the unknown names it dropped, or throws `ToolError`. */
export type PrepareCall = (tool: ToolDef, raw: unknown) => { args: Record<string, unknown>; ignored: string[] };

/**
 * Serves a backend's tools over MCP. `backend.tools()` is read once; a
 * duplicate name or a non-flat tool throws.
 */
export function createServer(backend: ToolBackend, info: { name: string; version: string }): Server {
  return serveTools(backend, info, prepareCall);
}

/** createServer with another argument check; the eval's plain mode uses it. */
export function serveTools(
  backend: ToolBackend,
  info: { name: string; version: string },
  prepare: PrepareCall,
): Server {
  const tools = backend.tools();
  const seen = new Set<string>();
  for (const tool of tools) {
    assertFlat(tool);
    if (seen.has(tool.name)) throw new Error(`Duplicate tool '${tool.name}'.`);
    seen.add(tool.name);
  }
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => {
      const entry: {
        name: string;
        description: string;
        inputSchema: unknown;
        annotations?: ToolAnnotations;
      } = { name: t.name, description: t.description, inputSchema: JSON.parse(JSON.stringify(t.parameters)) };
      if (t.annotations !== undefined) entry.annotations = t.annotations;
      return entry;
    }),
  }));

  // The SDK's Server.setRequestHandler checks tools/call against a strict schema
  // (arguments must be a record); a lenient handler on the base Protocol lets
  // prepareArguments see a string, null or array and answer with a sentence.
  const LenientCallToolRequestSchema = z.object({
    method: z.literal("tools/call"),
    params: z.object({ name: z.string(), arguments: z.unknown().optional() }),
  });
  Protocol.prototype.setRequestHandler.call(
    server,
    LenientCallToolRequestSchema,
    async (req: z.infer<typeof LenientCallToolRequestSchema>) => {
      const name = req.params.name;
      const tool = byName.get(name);
      if (tool === undefined) {
        return fail(`Unknown tool '${name}'. Tools: ${tools.map((t) => t.name).join(", ")}.`);
      }
      let prepared: { args: Record<string, unknown>; ignored: string[] };
      try {
        prepared = prepare(tool, req.params.arguments);
      } catch (e) {
        if (e instanceof ToolError) return fail(e.message);
        throw e;
      }
      try {
        let text = await backend.call(name, prepared.args);
        if (prepared.ignored.length > 0) {
          const names = Object.keys((tool.parameters as unknown as { properties: object }).properties);
          const dropped = prepared.ignored.map((k) => `Ignored unknown argument '${k}'.`).join(" ");
          text += `\n${dropped} ${name} takes: ${names.join(", ")}.`;
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        if (e instanceof ToolError) return fail(e.message);
        const errName = e instanceof Error ? e.name : "Error";
        console.error(`[heim-mcp] ${name} failed: ${errName}`);
        return fail(`The tool '${name}' failed with an internal error.`);
      }
    },
  );

  return server;
}
