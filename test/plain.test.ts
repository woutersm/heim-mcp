import { describe, expect, it } from "vitest";
import { createDemoBackend, connect, ToolError, type ToolDef } from "../src/index.ts";
import { plainArguments, plainCall } from "../src/eval/plain.ts";

const backend = () => createDemoBackend("2026-03-02");
const tools = Object.fromEntries(backend().tools().map((t) => [t.name, t])) as Record<string, ToolDef>;

function plainError(tool: ToolDef, raw: unknown): string {
  try {
    plainArguments(tool, raw);
  } catch (e) {
    if (e instanceof ToolError) return e.message;
    throw e;
  }
  throw new Error("expected plainArguments to throw");
}

describe("plainArguments", () => {
  it("passes exact arguments through", () => {
    expect(plainArguments(tools.todo_add, { title: "Eggs", list: "shopping" })).toEqual({ title: "Eggs", list: "shopping" });
  });

  it("drops unknown keys, as a zod object does", () => {
    expect(plainArguments(tools.todo_add, { title: "Eggs", colour: "red" })).toEqual({ title: "Eggs" });
  });

  it("reads missing arguments as an empty object", () => {
    expect(plainArguments(tools.todo_list, undefined)).toEqual({});
  });

  it("rejects an enum value in another case or an alias value", () => {
    expect(plainError(tools.todo_add, { title: "Eggs", list: "Groceries" })).toBe(
      "Input validation error: Invalid arguments for tool todo_add: /list must be equal to one of the allowed values",
    );
    expect(plainError(tools.todo_add, { title: "Eggs", list: "Shopping" })).toContain("/list");
  });

  it("rejects a number sent as a string", () => {
    expect(plainError(tools.todo_done, { id: "4" })).toBe(
      "Input validation error: Invalid arguments for tool todo_done: /id must be integer",
    );
  });

  it("rejects an argument alias and a null optional", () => {
    expect(plainError(tools.todo_done, { todo_id: 4 })).toBe(
      "Input validation error: Invalid arguments for tool todo_done: must have required properties id",
    );
    expect(plainError(tools.todo_add, { title: "Broom", list: null })).toBe(
      "Input validation error: Invalid arguments for tool todo_add: /list must be equal to one of the allowed values",
    );
  });

  it("rejects arguments that are not an object", () => {
    expect(plainError(tools.todo_add, "{\"title\":\"Eggs\"}")).toBe(
      "Input validation error: Invalid arguments for tool todo_add: must be object",
    );
  });
});

describe("connect with plainCall", () => {
  it("serves the same tools and answers a schema miss with the plain sentence", async () => {
    const client = await connect(backend(), plainCall);
    const listed = await client.listTools();
    expect(listed.tools.map((t) => t.name)).toEqual(Object.keys(tools));
    const miss = (await client.callTool({ name: "todo_add", arguments: { title: "Eggs", list: "Groceries" } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(miss.isError).toBe(true);
    expect(miss.content[0].text).toContain("Input validation error");
    const hit = (await client.callTool({ name: "todo_add", arguments: { title: "Eggs", list: "shopping" } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(hit.isError).toBeUndefined();
    expect(hit.content[0].text).toMatch(/^Added #\d+ 'Eggs' to shopping/);
    await client.close();
  });
});
