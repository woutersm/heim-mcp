import { describe, expect, it } from "vitest";
import { createDemoBackend, prepareArguments, type ToolDef } from "../src/index.ts";
import { describeCorrections } from "../src/eval/corrections.ts";
import { plainArguments } from "../src/eval/plain.ts";

const tools = Object.fromEntries(createDemoBackend("2026-03-02").tools().map((t) => [t.name, t])) as Record<string, ToolDef>;
const heim = (tool: ToolDef, raw: Record<string, unknown>) => describeCorrections(tool, raw, prepareArguments(tool, raw));

describe("describeCorrections", () => {
  it("is empty for a call sent exactly as the schema asks", () => {
    expect(heim(tools.todo_add, { title: "Milk", list: "shopping" })).toEqual([]);
  });

  it("names a renamed argument and a changed value", () => {
    expect(heim(tools.todo_add, { text: "Milk", list: "Groceries", due: "tomorrow" })).toEqual([
      "text→title",
      'list "Groceries"→"shopping"',
    ]);
  });

  it("names a number sent as a string and a case-only rename", () => {
    expect(heim(tools.todo_done, { ID: "4" })).toEqual(["ID→id", 'id "4"→4']);
  });

  it("names a dropped null", () => {
    expect(heim(tools.todo_add, { title: "Broom", list: null })).toEqual(["list null dropped"]);
  });

  it("names an unknown key a plain server drops", () => {
    const raw = { title: "Milk", priority: "high" };
    expect(describeCorrections(tools.todo_add, raw, plainArguments(tools.todo_add, raw))).toEqual(["priority dropped"]);
  });

  it("names an empty optional string and a name with whitespace", () => {
    expect(heim(tools.todo_add, { title: "Broom", list: "" })).toEqual(['list "" dropped']);
    expect(heim(tools.todo_add, { "title\n": "Milk" })).toEqual(['"title\\n"→title']);
  });
});
