import { describe, expect, it } from "vitest";

import { loadCases, type CaseFileT } from "../src/eval/cases.ts";
import { runEval } from "../src/eval/run.ts";
import type { ModelOptions } from "../src/eval/model.ts";
import { ID_HINT, TITLE_HINT } from "../src/eval/variants.ts";

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
    expect(lines[lines.length - 1]).toBe("23/23 cases");
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
      "calls: 0 ran, 0 corrected, 0 rejected",
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

  const eggsCase: CaseFileT = {
    today: "2026-03-02",
    cases: [
      {
        id: "eggs",
        message: "Put eggs on the groceries",
        calls: [{ name: "todo_add", arguments: { title: "Eggs", list: "Groceries" }, reply: "..." }],
      },
    ],
  };

  function callMessage(id: string, name: string, args: Record<string, unknown>): ChatResponse {
    return {
      choices: [
        { message: { role: "assistant", tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    };
  }

  it("model mode does not count a call the server turned away", async () => {
    const f = new ScriptedFetch().push(
      callMessage("c1", "todo_add", { list: "shopping" }),
      callMessage("c2", "todo_add", { title: "Eggs", list: "shopping" }),
      answerMessage("Added."),
    );
    const model: ModelOptions = { baseUrl: "http://x/v1", model: "local", fetch: f.call };
    const { lines, ok } = await runEval(eggsCase, model);
    expect(lines).toEqual([
      'ok   eggs (rejected: todo_add {"list":"shopping"})',
      "calls: 1 ran, 0 corrected, 1 rejected",
      "1/1 cases, 0 replay-only skipped",
    ]);
    expect(ok).toBe(true);
  });

  it("plain mode fails a call that heim-mcp would have corrected", async () => {
    const script = () =>
      new ScriptedFetch().push(callMessage("c1", "todo_add", { title: "Eggs", list: "Groceries" }), answerMessage("Added."));
    const heim = await runEval(eggsCase, { baseUrl: "http://x/v1", model: "local", fetch: script().call });
    expect(heim.lines[0]).toBe('ok   eggs (corrected: list "Groceries"→"shopping")');
    expect(heim.lines[1]).toBe("calls: 1 ran, 1 corrected, 0 rejected");
    const plain = await runEval(eggsCase, { baseUrl: "http://x/v1", model: "local", fetch: script().call, plain: true });
    expect(plain.lines[0]).toBe('FAIL eggs: expected 1 calls, got 0 (rejected: todo_add {"title":"Eggs","list":"Groceries"})');
    expect(plain.lines[1]).toBe("calls: 0 ran, 0 corrected, 1 rejected");
    expect(plain.ok).toBe(false);
  });

  it("plain mode passes when the model reads the error and retries correctly", async () => {
    const f = new ScriptedFetch().push(
      callMessage("c1", "todo_add", { title: "Eggs", list: "Groceries" }),
      callMessage("c2", "todo_add", { title: "Eggs", list: "shopping" }),
      answerMessage("Added."),
    );
    const { lines } = await runEval(eggsCase, { baseUrl: "http://x/v1", model: "local", fetch: f.call, plain: true });
    expect(lines[0]).toBe('ok   eggs (rejected: todo_add {"title":"Eggs","list":"Groceries"})');
  });

  it("scores the arguments the server ran, not the ones the model sent", async () => {
    const garden: CaseFileT = {
      today: "2026-03-02",
      cases: [{ id: "garden", message: "What's left in the garden?", calls: [{ name: "todo_list", arguments: { list: "garden" }, reply: "..." }] }],
    };
    const script = () =>
      new ScriptedFetch().push(callMessage("c1", "todo_list", { "list\n": "garden" }), answerMessage("Two things."));
    const heim = await runEval(garden, { baseUrl: "http://x/v1", model: "local", fetch: script().call });
    expect(heim.lines[0]).toBe('ok   garden (corrected: "list\\n"→list)');
    const plain = await runEval(garden, { baseUrl: "http://x/v1", model: "local", fetch: script().call, plain: true });
    expect(plain.lines[0]).toBe(
      'FAIL garden: call 1: argument \'list\' expected "garden", got <absent> (corrected: "list\\n" dropped)',
    );
  });

  it("scores a call by title with the id it reached the backend with", async () => {
    const kettle: CaseFileT = {
      today: "2026-03-02",
      cases: [{ id: "kettle", message: "Mark the kettle as done", calls: [{ name: "todo_done", arguments: { id: 5 }, reply: "..." }] }],
    };
    const script = () =>
      new ScriptedFetch().push(callMessage("c1", "todo_done", { title: "kettle" }), answerMessage("Done."));
    const lookup = await runEval(kettle, { baseUrl: "http://x/v1", model: "local", fetch: script().call, titleLookup: true });
    expect(lookup.lines.slice(0, 2)).toEqual(["ok   kettle", "calls: 1 ran, 0 corrected, 0 rejected"]);
    const idsOnly = await runEval(kettle, { baseUrl: "http://x/v1", model: "local", fetch: script().call });
    expect(idsOnly.lines[0]).toBe('FAIL kettle: expected 1 calls, got 0 (rejected: todo_done {"title":"kettle"})');
  });

  it("model mode serves the variant tools the options ask for", async () => {
    const bodies: { tools: { function: { name: string; parameters: { properties: Record<string, object> } } }[] }[] = [];
    const capture = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answerMessage("ok")), { status: 200 });
    }) as typeof fetch;
    const one: CaseFileT = { today: "2026-03-02", cases: [{ id: "a", message: "hi", calls: [] }] };
    await runEval(one, { baseUrl: "http://x/v1", model: "local", fetch: capture, extraTools: true, noDescriptions: true });
    expect(bodies[0].tools).toHaveLength(11);
    const add = bodies[0].tools.find((t) => t.function.name === "todo_add")!;
    expect(add.function.parameters.properties.title).toEqual({ type: "string" });
  });

  it("model mode serves the hints the options ask for", async () => {
    const bodies: { tools: { function: { name: string; parameters: { properties: Record<string, { description?: string }> } } }[] }[] = [];
    const capture = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(answerMessage("ok")), { status: 200 });
    }) as typeof fetch;
    const one: CaseFileT = { today: "2026-03-02", cases: [{ id: "a", message: "hi", calls: [] }] };
    await runEval(one, { baseUrl: "http://x/v1", model: "local", fetch: capture, titleHint: true, idHint: true });
    const tool = (name: string) => bodies[0].tools.find((t) => t.function.name === name)!.function.parameters.properties;
    expect(tool("todo_add").title.description).toBe(TITLE_HINT);
    expect(tool("todo_delete").id.description).toBe(ID_HINT);
  });

  it("prints an unscored case with what ran and the answer, and leaves it out of the score", async () => {
    const file: CaseFileT = {
      today: "2026-03-02",
      cases: [{ id: "soap", message: "Put soap on the school list", calls: [], unscored: true }],
    };
    const f = new ScriptedFetch().push(callMessage("c1", "todo_add", { title: "Soap", list: "home" }), answerMessage("Added soap."));
    const { lines, ok } = await runEval(file, { baseUrl: "http://x/v1", model: "local", fetch: f.call });
    expect(lines).toEqual([
      '---- soap: todo_add {"title":"Soap","list":"home"} | answer: Added soap.',
      "calls: 1 ran, 0 corrected, 0 rejected",
      "0/0 cases, 0 replay-only skipped, 1 unscored",
    ]);
    expect(ok).toBe(true);
  });

  it("replays every shipped case file without a failure", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("eval").filter((f) => f.endsWith("-cases.json"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const { lines, ok } = await runEval(loadCases(`eval/${name}`));
      expect(lines.filter((l) => l.startsWith("FAIL")), name).toEqual([]);
      expect(ok, name).toBe(true);
    }
  });
});
