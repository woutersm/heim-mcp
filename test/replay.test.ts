import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCases, type EvalCase } from "../src/eval/cases.ts";
import { replayCase } from "../src/eval/replay.ts";
import { createDemoBackend } from "../src/demo/backend.ts";

const file = loadCases(new URL("../eval/demo-cases.json", import.meta.url).pathname);

describe("every golden case replays clean", () => {
  for (const c of file.cases) {
    it(c.id, async () => {
      const mismatches = await replayCase(createDemoBackend(file.today), c);
      expect(mismatches).toEqual([]);
    });
  }
});

describe("replayCase mismatch lines", () => {
  it("reports a wrong golden reply as the exact line", async () => {
    const c: EvalCase = {
      id: "wrong-golden",
      message: "Put milk on the groceries",
      calls: [
        {
          name: "todo_add",
          arguments: { text: "Milk", list: "Groceries" },
          reply: "Added #9 'Milk' to home.",
        },
      ],
    };
    const mismatches = await replayCase(createDemoBackend("2026-03-02"), c);
    expect(mismatches).toEqual([
      `call 1: expected "Added #9 'Milk' to home.", got "Added #9 'Milk' to shopping."`,
    ]);
  });

  it("reports 'expected an error, got a result' when a call succeeds", async () => {
    const c: EvalCase = {
      id: "wrong-error-flag",
      message: "Done with the gate latch",
      calls: [
        {
          name: "todo_done",
          arguments: { id: 3 },
          reply: "Done: #3 'Fix the gate latch'.",
          error: true,
        },
      ],
    };
    const mismatches = await replayCase(createDemoBackend("2026-03-02"), c);
    expect(mismatches).toEqual(["call 1: expected an error, got a result"]);
  });

  it("reports 'expected a result, got an error' when a call fails", async () => {
    const c: EvalCase = {
      id: "missing-error-flag",
      message: "Finish task 99",
      calls: [
        {
          name: "todo_done",
          arguments: { id: 99 },
          reply: "No todo #99. Use todo_list to see the ids.",
        },
      ],
    };
    const mismatches = await replayCase(createDemoBackend("2026-03-02"), c);
    expect(mismatches).toEqual(["call 1: expected a result, got an error"]);
  });
});

describe("loadCases", () => {
  function tmp(name: string, contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "heim-mcp-eval-"));
    const path = join(dir, name);
    writeFileSync(path, contents);
    return path;
  }

  it("refuses a file with a missing reply", () => {
    const path = tmp(
      "missing-reply.json",
      JSON.stringify({
        today: "2026-03-02",
        cases: [
          { id: "x", message: "m", calls: [{ name: "todo_done", arguments: { id: 3 } }] },
        ],
      }),
    );
    expect(() => loadCases(path)).toThrowError(`${path}: not a case file.`);
  });

  it("refuses a file with a duplicate case id", () => {
    const path = tmp(
      "dup.json",
      JSON.stringify({
        today: "2026-03-02",
        cases: [
          { id: "x", message: "m", calls: [] },
          { id: "x", message: "m2", calls: [] },
        ],
      }),
    );
    expect(() => loadCases(path)).toThrowError(`${path}: duplicate case id 'x'.`);
  });
});
