import { describe, expect, it } from "vitest";

import { createDemoBackend } from "../src/demo/backend.ts";
import { matchCalls } from "../src/eval/match.ts";
import type { EvalCall } from "../src/eval/cases.ts";

const tools = createDemoBackend("2026-03-02").tools();

const add = (args: Record<string, unknown>, reply = ""): EvalCall => ({
  name: "todo_add",
  arguments: args,
  reply,
});

describe("matchCalls", () => {
  it("reports a call-count difference", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk" }), add({ text: "Oats" })],
      [{ name: "todo_add", arguments: { text: "Milk" } }],
      tools,
    );
    expect(mismatches).toEqual(["expected 2 calls, got 1"]);
  });

  it("reports a name difference per position", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping" })],
      [{ name: "todo_delete", arguments: { list: "shopping" } }],
      tools,
    );
    expect(mismatches).toEqual(["call 1: expected todo_add, got todo_delete"]);
  });

  it("reports an expected argument that is missing", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk", list: "shopping" })],
      [{ name: "todo_add", arguments: { text: "Milk" } }],
      tools,
    );
    expect(mismatches).toEqual(['call 1: argument \'list\' expected "shopping", got <absent>']);
  });

  it("reports an expected argument that is different", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping" })],
      [{ name: "todo_add", arguments: { list: "home" } }],
      tools,
    );
    expect(mismatches).toEqual(['call 1: argument \'list\' expected "shopping", got "home"']);
  });

  it("treats values equal up to trimming and lower-casing as matching", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping", text: "Milk" })],
      [{ name: "todo_add", arguments: { list: "  SHOPPING ", text: "milk" } }],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("allows extra actual arguments", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk" })],
      [{ name: "todo_add", arguments: { text: "Milk", due: "tomorrow" } }],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("is clean when expected and actual agree", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk", list: "shopping" }), { name: "todo_done", arguments: { id: 9 }, reply: "" }],
      [
        { name: "todo_add", arguments: { text: "Milk", list: "shopping" } },
        { name: "todo_done", arguments: { id: 9 } },
      ],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("matches a strict call against an expected call written with aliases and alias values", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk", list: "Groceries", due: "tomorrow" })],
      [{ name: "todo_add", arguments: { title: "Milk", list: "shopping", due: "tomorrow" } }],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("matches a string id against a number id after prepareArguments", () => {
    const mismatches = matchCalls(
      [{ name: "todo_done", arguments: { id: "4" }, reply: "" }],
      [{ name: "todo_done", arguments: { id: 4 } }],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("ignores an extra read-only call that no expected call names", () => {
    const mismatches = matchCalls(
      [{ name: "todo_done", arguments: { id: 3 }, reply: "" }],
      [
        { name: "todo_search", arguments: { query: "latch" } },
        { name: "todo_done", arguments: { id: 3 } },
      ],
      tools,
    );
    expect(mismatches).toEqual([]);
  });

  it("still requires a read-only call that a case expects", () => {
    const mismatches = matchCalls(
      [{ name: "todo_list", arguments: { list: "garden" }, reply: "" }],
      [],
      tools,
    );
    expect(mismatches).toEqual(["expected 1 calls, got 0"]);
  });

  it("compares an expected call whose arguments fail prepareArguments as written", () => {
    const mismatches = matchCalls(
      [{ name: "todo_done", arguments: { id: "three" }, reply: "" }],
      [{ name: "todo_done", arguments: { id: 3 } }],
      tools,
    );
    expect(mismatches).toEqual(['call 1: argument \'id\' expected "three", got 3']);
  });

  it("matches 'today' and 'tomorrow' with their dates when given the case file's today", () => {
    const expected = [add({ title: "Milk", due: "tomorrow" }), add({ title: "Oats", due: "2026-03-02" })];
    const actual = [
      { name: "todo_add", arguments: { title: "Milk", due: "2026-03-03" } },
      { name: "todo_add", arguments: { title: "Oats", due: "Today" } },
    ];
    expect(matchCalls(expected, actual, tools, "2026-03-02")).toEqual([]);
    expect(matchCalls(expected, actual, tools)).toHaveLength(2);
  });

  it("still reports a date that is not the day word's date", () => {
    const mismatches = matchCalls(
      [add({ title: "Milk", due: "tomorrow" })],
      [{ name: "todo_add", arguments: { title: "Milk", due: "2026-03-04" } }],
      tools,
      "2026-03-02",
    );
    expect(mismatches).toEqual(['call 1: argument \'due\' expected "tomorrow", got "2026-03-04"']);
  });
});
