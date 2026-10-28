import Value from "typebox/value";
import { ToolError, type ToolDef } from "../tools.ts";

/**
 * The argument check of a plain MCP server, for comparison with heim-mcp:
 * unknown keys are dropped, as a zod object drops them, and anything else
 * that misses the schema is rejected with the SDK's validation sentence.
 * No aliases, no case folding, no type coercion, no null removal.
 */
export function plainArguments(tool: ToolDef, raw: unknown): Record<string, unknown> {
  const fail = (detail: string) =>
    new ToolError(`Input validation error: Invalid arguments for tool ${tool.name}: ${detail}`);
  if (raw === undefined) raw = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw fail("must be object");
  const properties = (tool.parameters as unknown as { properties: Record<string, unknown> }).properties;
  const names = Object.keys(properties);
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (names.includes(key)) args[key] = value;
  const errors = Value.Errors(tool.parameters, args);
  if (errors.length > 0) {
    throw fail(errors.map((e) => (e.instancePath === "" ? e.message : `${e.instancePath} ${e.message}`)).join("; "));
  }
  return args;
}

/** plainArguments in the shape the server takes; a plain server never says what it dropped. */
export function plainCall(tool: ToolDef, raw: unknown): { args: Record<string, unknown>; ignored: string[] } {
  return { args: plainArguments(tool, raw), ignored: [] };
}
