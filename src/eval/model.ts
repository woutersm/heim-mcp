import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { EvalCase } from "./cases.ts";
import { HISTORY } from "./variants.ts";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

export type ModelOptions = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetch: typeof fetch;
  maxSteps?: number;
  /** Serve the tools with a plain MCP schema check instead of heim-mcp's, for comparison. */
  plain?: boolean;
  /** Sent as `reasoning_effort` when set; "none" turns thinking off on servers that support it. */
  reasoningEffort?: string;
  /** Put twelve earlier turns of household chat before each case's message. */
  history?: boolean;
  /** Serve the tools without argument descriptions. */
  noDescriptions?: boolean;
  /** Serve six more household tools beside the todo tools. */
  extraTools?: boolean;
};

const SYSTEM = (today: string) =>
  `You manage a household todo list through tools. Today is ${today}. Use the tools, then answer in one short sentence.`;

/**
 * Drives a case through a real model: asks the endpoint for messages, calls the
 * MCP tools it asks for, and returns every call it made plus the final answer.
 */
export async function runModelCase(
  client: Client,
  c: EvalCase,
  today: string,
  opts: ModelOptions,
): Promise<{ calls: { name: string; arguments: Record<string, unknown> }[]; answer: string }> {
  const listed = await client.listTools();
  const tools = listed.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM(today) },
    ...(opts.history === true ? HISTORY : []),
    { role: "user", content: c.message },
  ];
  const calls: { name: string; arguments: Record<string, unknown> }[] = [];
  const maxSteps = opts.maxSteps ?? 6;
  let answer = "";

  for (let step = 0; step < maxSteps; step++) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.apiKey !== undefined) headers.authorization = `Bearer ${opts.apiKey}`;
    const res = await opts.fetch(`${opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        messages,
        tools,
        ...(opts.reasoningEffort !== undefined && { reasoning_effort: opts.reasoningEffort }),
      }),
    });
    if (!res.ok) throw new Error(`Model endpoint answered ${res.status}.`);
    const data = (await res.json()) as { choices?: { message?: AssistantMessage }[] };
    const message = data.choices?.[0]?.message;
    if (message?.tool_calls && message.tool_calls.length > 0) {
      // Send the assistant message back as it came (content may be absent).
      messages.push(message as ChatMessage);
      for (const tc of message.tool_calls) {
        let args: Record<string, unknown>;
        let parsed: unknown;
        try {
          parsed = JSON.parse(tc.function.arguments);
        } catch {
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Invalid arguments: not valid JSON." });
          calls.push({ name: tc.function.name, arguments: {} });
          continue;
        }
        if (
          parsed === null ||
          typeof parsed !== "object" ||
          Array.isArray(parsed)
        ) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: "Invalid arguments: expected a JSON object." });
          calls.push({ name: tc.function.name, arguments: {} });
          continue;
        }
        args = parsed as Record<string, unknown>;
        calls.push({ name: tc.function.name, arguments: args });
        const toolResult = (await client.callTool({ name: tc.function.name, arguments: args })) as {
          content: unknown;
          isError?: boolean;
        };
        const first = (toolResult.content as Array<{ type: string; text?: string }>)[0];
        const text = first?.text ?? "";
        messages.push({ role: "tool", tool_call_id: tc.id, content: text });
      }
    } else {
      answer = message?.content ?? "";
      break;
    }
  }
  return { calls, answer };
}
