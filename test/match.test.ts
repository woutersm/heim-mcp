import { describe, expect, it } from "vitest";

import { matchCalls } from "../src/eval/match.ts";
import type { EvalCall } from "../src/eval/cases.ts";

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
    );
    expect(mismatches).toEqual(["expected 2 calls, got 1"]);
  });

  it("reports a name difference per position", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping" })],
      [{ name: "todo_list", arguments: { list: "shopping" } }],
    );
    expect(mismatches).toEqual(["call 1: expected todo_add, got todo_list"]);
  });

  it("reports an expected argument that is missing", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk", list: "shopping" })],
      [{ name: "todo_add", arguments: { text: "Milk" } }],
    );
    expect(mismatches).toEqual(['call 1: argument \'list\' expected "shopping", got <absent>']);
  });

  it("reports an expected argument that is different", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping" })],
      [{ name: "todo_add", arguments: { list: "home" } }],
    );
    expect(mismatches).toEqual(['call 1: argument \'list\' expected "shopping", got "home"']);
  });

  it("treats values equal up to trimming and lower-casing as matching", () => {
    const mismatches = matchCalls(
      [add({ list: "shopping", text: "Milk" })],
      [{ name: "todo_add", arguments: { list: "  SHOPPING ", text: "milk" } }],
    );
    expect(mismatches).toEqual([]);
  });

  it("allows extra actual arguments", () => {
    const mismatches = matchCalls(
      [add({ text: "Milk" })],
      [{ name: "todo_add", arguments: { text: "Milk", due: "tomorrow" } }],
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
    );
    expect(mismatches).toEqual([]);
  });
});
