import { connect } from "./connect.ts";
import type { EvalCase } from "./cases.ts";
import type { ToolBackend } from "../tools.ts";

function resultText(res: { content: unknown }): string {
  const first = (res.content as Array<{ type: string; text?: string }>)[0];
  return first?.text ?? "";
}

/**
 * Replays a case against a fresh backend over an in-memory MCP client.
 * Returns one line per mismatch; empty means the case passed.
 */
export async function replayCase(backend: ToolBackend, c: EvalCase): Promise<string[]> {
  const client = await connect(backend);
  const mismatches: string[] = [];
  try {
    for (let i = 0; i < c.calls.length; i++) {
      const call = c.calls[i];
      const res = (await client.callTool({ name: call.name, arguments: call.arguments })) as {
        content: unknown;
        isError?: boolean;
      };
      const isError = res.isError === true;
      const got = resultText(res);
      if (call.error) {
        if (!isError) mismatches.push(`call ${i + 1}: expected an error, got a result`);
        else if (got !== call.reply)
          mismatches.push(`call ${i + 1}: expected "${call.reply}", got "${got}"`);
      } else {
        if (isError) mismatches.push(`call ${i + 1}: expected a result, got an error`);
        else if (got !== call.reply) mismatches.push(`call ${i + 1}: expected "${call.reply}", got "${got}"`);
      }
    }
  } finally {
    await client.close();
  }
  return mismatches;
}
