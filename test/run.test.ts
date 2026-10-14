import { describe, expect, it } from "vitest";

import { loadCases, type CaseFileT } from "../src/eval/cases.ts";
import { runEval } from "../src/eval/run.ts";
import type { ModelOptions } from "../src/eval/model.ts";

type ChatMessage = {
  role: "assistant";
  content?: string;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
};
type ChatResponse = { choices: [{ message: ChatMessage }] };

class ScriptedFetch {
  queue: (ChatResponse | { status: number })[] = [];

  push(...items: (ChatResponse | { status: number })[]) {
    this.queue.push(...items);
    return this;
  }

  call = (async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = this.queue.shift();
    if (next === undefined) throw new Error("scripted fetch ran out of responses");
    if ("status" in next) return new Response("boom", { status: next.status });
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
}

function answerMessage(content: string): ChatResponse {
  return { choices: [{ message: { role: "assistant", content } }] };
}

describe("runEval", () => {
  it("replay mode on the shipped cases passes every case", async () => {
    const file = loadCases("eval/demo-cases.json");
    const { lines, ok } = await runEval(file);
    for (const line of lines) expect(line).not.toMatch(/^FAIL/);
    expect(lines[lines.length - 1]).toBe("15/15 cases");
    expect(ok).toBe(true);
  });

  it("model mode skips a replay_only case and scores the rest", async () => {
    const file: CaseFileT = {
      today: "2026-03-02",
      cases: [
        {
          id: "replay-only-case",
          message: "Add a todo with no title",
          replay_only: true,
          calls: [{ name: "todo_add", arguments: { list: "home" }, reply: "Missing argument 'title'.", error: true }],
        },
        {
          id: "list-case",
          message: "What is on the home list?",
          calls: [{ name: "todo_list", arguments: { list: "home" }, reply: "..." }],
        },
      ],
    };
    const f = new ScriptedFetch().push(answerMessage("There are items."));
    const model: ModelOptions = { baseUrl: "http://localhost:8080/v1", model: "local", fetch: f.call };
    const { lines, ok } = await runEval(file, model);

    expect(lines).toEqual([
      "skip replay-only-case (replay only)",
      "FAIL list-case: expected 1 calls, got 0",
      "0/1 cases, 1 replay-only skipped",
    ]);
    expect(ok).toBe(false);
    expect(f.queue).toHaveLength(0); // exactly one endpoint request: the scored case
  });

  it("model mode turns a thrown endpoint error into one FAIL line and keeps going", async () => {
    const file: CaseFileT = {
      today: "2026-03-02",
      cases: [
        {
          id: "first",
          message: "What is on the home list?",
          calls: [{ name: "todo_list", arguments: { list: "home" }, reply: "..." }],
        },
        {
          id: "second",
          message: "What is on the garden list?",
          calls: [{ name: "todo_list", arguments: { list: "garden" }, reply: "..." }],
        },
      ],
    };
    const f = new ScriptedFetch().push({ status: 500 }).push(answerMessage("Done."));
    const model: ModelOptions = { baseUrl: "http://localhost:8080/v1", model: "local", fetch: f.call };
    const { lines, ok } = await runEval(file, model);

    expect(lines[0]).toBe("FAIL first: Model endpoint answered 500.");
    expect(lines[1].startsWith("FAIL second")).toBe(true);
    expect(lines[lines.length - 1]).toBe("0/2 cases, 0 replay-only skipped");
    expect(ok).toBe(false);
  });
});
