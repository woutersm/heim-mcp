import { describe, expect, it } from "vitest";

import { connect } from "../src/eval/connect.ts";
import { runModelCase } from "../src/eval/model.ts";
import { createDemoBackend } from "../src/demo/backend.ts";
import type { EvalCase } from "../src/eval/cases.ts";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type ChatMessage = {
  role: "assistant";
  content?: string;
  tool_calls?: ToolCall[];
};
type ChatResponse = { choices: [{ message: ChatMessage }] };

class ScriptedFetch {
  requests: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  queue: (ChatResponse | { status: number })[] = [];

  push(...items: (ChatResponse | { status: number })[]) {
    this.queue.push(...items);
    return this;
  }

  call = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h instanceof Headers) for (const [k, v] of h) headers[k.toLowerCase()] = v;
    else if (Array.isArray(h)) for (const [k, v] of h) headers[k.toLowerCase()] = String(v);
    else if (h !== undefined) for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    this.requests.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = this.queue.shift();
    if (next === undefined) throw new Error("scripted fetch ran out of responses");
    if ("status" in next) return new Response("boom", { status: next.status });
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
}

const CASE: EvalCase = { id: "milk", message: "Put milk on the groceries", calls: [] };

function toolCallMessage(name: string, argumentsJson: string): ChatResponse {
  return {
    choices: [
      { message: { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: argumentsJson } }] } },
    ],
  };
}

function answerMessage(content: string): ChatResponse {
  return { choices: [{ message: { role: "assistant", content } }] };
}

async function setup() {
  const client = await connect(createDemoBackend("2026-03-02"));
  return client;
}

describe("runModelCase", () => {
  it("runs a two-step exchange and sends the tool reply back as a tool message", async () => {
    const client = await setup();
    const f = new ScriptedFetch()
      .push(toolCallMessage("todo_add", JSON.stringify({ text: "Milk", list: "shopping" })))
      .push(answerMessage("Milk is on the groceries."));
    const result = await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f.call,
    });
    await client.close();

    expect(result.calls).toEqual([{ name: "todo_add", arguments: { text: "Milk", list: "shopping" } }]);
    expect(result.answer).toBe("Milk is on the groceries.");
    expect(f.requests).toHaveLength(2);
    const second = f.requests[1].body.messages as { role: string; content?: string; tool_call_id?: string }[];
    // The assistant message went back as it came (no content key in the model's reply).
    expect(second[2]).toEqual({ role: "assistant", tool_calls: expect.any(Array) });
    expect("content" in second[2]).toBe(false);
    // The tool result went back after it, with the matching id.
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Added #9 'Milk' to shopping." });
  });

  it("works when the tool-call message has no content key", async () => {
    const client = await setup();
    const f = new ScriptedFetch()
      .push({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "call_2", type: "function", function: { name: "todo_list", arguments: "{}" } }] } }] })
      .push(answerMessage("There are items."));
    const result = await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f.call,
    });
    await client.close();
    expect(result.answer).toBe("There are items.");
    expect(result.calls).toEqual([{ name: "todo_list", arguments: {} }]);
    const second = f.requests[1].body.messages as { role: string; tool_call_id?: string; content?: string }[];
    expect(second[3].role).toBe("tool");
    expect(second[3].tool_call_id).toBe("call_2");
  });

  it("sends back the invalid-arguments sentence and never calls a tool for unparseable JSON", async () => {
    const client = await setup();
    const before = await client.callTool({ name: "todo_list", arguments: {} });
    const f = new ScriptedFetch()
      .push(toolCallMessage("todo_add", "{not json"))
      .push(answerMessage("Sorry."));
    const result = await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f.call,
    });
    const after = await client.callTool({ name: "todo_list", arguments: {} });
    await client.close();

    const text = (r: unknown) => ((r as { content: { text?: string }[] }).content[0]?.text ?? "");
    // The backend state is unchanged: no todo was added.
    expect(text(after)).toBe(text(before));
    // The recorded call keeps the parsed-{} arguments.
    expect(result.calls).toEqual([{ name: "todo_add", arguments: {} }]);
    const second = f.requests[1].body.messages as { role: string; tool_call_id?: string; content?: string }[];
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Invalid arguments: not valid JSON." });
  });

  it.each([["null"], ["[1]"]])("treats non-object JSON %s like unparseable JSON and never calls the tool", async (argumentsJson) => {
    const client = await setup();
    const before = await client.callTool({ name: "todo_list", arguments: {} });
    const f = new ScriptedFetch()
      .push(toolCallMessage("todo_add", argumentsJson))
      .push(answerMessage("Sorry."));
    const result = await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f.call,
    });
    const after = await client.callTool({ name: "todo_list", arguments: {} });
    await client.close();

    const text = (r: unknown) => ((r as { content: { text?: string }[] }).content[0]?.text ?? "");
    // The backend state is unchanged: no todo was added.
    expect(text(after)).toBe(text(before));
    // The recorded call keeps empty arguments.
    expect(result.calls).toEqual([{ name: "todo_add", arguments: {} }]);
    const second = f.requests[1].body.messages as { role: string; tool_call_id?: string; content?: string }[];
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "Invalid arguments: expected a JSON object." });
  });

  it("stops after maxSteps requests when the model never stops calling", async () => {
    const client = await setup();
    const f = new ScriptedFetch();
    for (let i = 0; i < 10; i++) f.push(toolCallMessage("todo_list", "{}"));
    const result = await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f.call,
      maxSteps: 2,
    });
    await client.close();
    expect(f.requests).toHaveLength(2);
    expect(result.calls).toHaveLength(2);
    expect(result.answer).toBe("");
  });

  it("throws when the endpoint answers non-2xx", async () => {
    const client = await setup();
    const f = new ScriptedFetch().push({ status: 500 });
    await expect(
      runModelCase(client, CASE, "2026-03-02", { baseUrl: "http://localhost:8080/v1", model: "local", fetch: f.call }),
    ).rejects.toThrow("Model endpoint answered 500.");
    await client.close();
  });

  it("gives up on a request the endpoint never answers", async () => {
    const client = await setup();
    const hang = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    await expect(
      runModelCase(client, CASE, "2026-03-02", { baseUrl: "http://x/v1", model: "local", fetch: hang, timeoutMs: 20 }),
    ).rejects.toThrow("Model endpoint did not answer within 0.02 seconds.");
    await client.close();
  });

  it("sends the system message with today, the user message, and all five tools", async () => {
    const client = await setup();
    const f = new ScriptedFetch().push(answerMessage("ok"));
    await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "qwen3-30b-a3b",
      fetch: f.call,
    });
    await client.close();
    const body = f.requests[0].body;
    expect(body.model).toBe("qwen3-30b-a3b");
    expect(body.temperature).toBe(0);
    expect(f.requests[0].url).toBe("http://localhost:8080/v1/chat/completions");
    const messages = body.messages as { role: string; content?: string }[];
    expect(messages[0]).toEqual({
      role: "system",
      content: "You manage a household todo list through tools. Today is 2026-03-02. Use the tools, then answer in one short sentence.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Put milk on the groceries" });
    const tools = body.tools as { type: string; function: { name: string; description?: string; parameters: unknown } }[];
    expect(tools.map((t) => t.function.name)).toEqual(["todo_add", "todo_list", "todo_done", "todo_delete", "todo_search"]);
    expect(tools.every((t) => t.type === "function")).toBe(true);
    expect(tools.every((t) => t.function.parameters !== undefined)).toBe(true);
  });

  it("sets the authorization header only when a key is provided", async () => {
    const client = await setup();
    const f = new ScriptedFetch().push(answerMessage("ok"));
    await runModelCase(client, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      apiKey: "sk-test",
      fetch: f.call,
    });
    await client.close();
    expect(f.requests[0].headers["content-type"]).toBe("application/json");
    expect(f.requests[0].headers["authorization"]).toBe("Bearer sk-test");

    const client2 = await setup();
    const f2 = new ScriptedFetch().push(answerMessage("ok"));
    await runModelCase(client2, CASE, "2026-03-02", {
      baseUrl: "http://localhost:8080/v1",
      model: "local",
      fetch: f2.call,
    });
    await client2.close();
    expect("authorization" in f2.requests[0].headers).toBe(false);
  });

  it("sends reasoning_effort only when it is set", async () => {
    const client = await setup();
    const f = new ScriptedFetch().push(answerMessage("ok"), answerMessage("ok"));
    const opts = { baseUrl: "http://localhost:8080/v1", model: "local", fetch: f.call };
    await runModelCase(client, CASE, "2026-03-02", { ...opts, reasoningEffort: "none" });
    await runModelCase(client, CASE, "2026-03-02", opts);
    await client.close();
    expect(f.requests[0].body.reasoning_effort).toBe("none");
    expect("reasoning_effort" in f.requests[1].body).toBe(false);
  });

  it("puts the earlier turns between the system message and the case's message when history is set", async () => {
    const { HISTORY } = await import("../src/eval/variants.ts");
    const client = await setup();
    const f = new ScriptedFetch().push(answerMessage("ok"), answerMessage("ok"));
    const opts = { baseUrl: "http://localhost:8080/v1", model: "local", fetch: f.call };
    await runModelCase(client, CASE, "2026-03-02", { ...opts, history: true });
    await runModelCase(client, CASE, "2026-03-02", opts);
    await client.close();
    const withHistory = f.requests[0].body.messages as { role: string; content?: string }[];
    expect(withHistory[0].role).toBe("system");
    expect(withHistory.slice(1, 13)).toEqual(HISTORY);
    expect(withHistory[13]).toEqual({ role: "user", content: "Put milk on the groceries" });
    expect(f.requests[1].body.messages as unknown[]).toHaveLength(2);
  });
});
