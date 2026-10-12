import { describe, expect, it } from "vitest";
import Type from "typebox";
import { prepareArguments, assertFlat, type ToolDef } from "../src/index.ts";

const todoAdd: ToolDef = {
  name: "todo_add",
  description: "Add a todo.",
  parameters: Type.Object({
    title: Type.String(),
    list: Type.Optional(Type.Enum(["home", "shopping", "garden"])),
    due: Type.Optional(Type.String()),
  }),
  argAliases: { text: "title", items: "list" },
  valueAliases: { list: { groceries: "shopping", boodschappen: "shopping" } },
};

const todoMaybe: ToolDef = {
  name: "maybe",
  description: "m",
  parameters: Type.Object({
    title: Type.Optional(Type.String()),
    list: Type.Optional(Type.Enum(["home", "shopping", "garden"])),
  }),
};

const todoDone: ToolDef = {
  name: "todo_done",
  description: "Mark a todo done.",
  parameters: Type.Object({
    id: Type.Integer({ minimum: 1 }),
  }),
};

function message(tool: ToolDef, raw: unknown): string {
  try {
    prepareArguments(tool, raw);
    return "<ok>";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("prepareArguments", () => {
  it("parses a JSON string argument", () => {
    expect(prepareArguments(todoAdd, '{"title":"Milk","list":"shopping"}')).toEqual({
      title: "Milk",
      list: "shopping",
    });
  });

  it("rejects invalid JSON", () => {
    expect(message(todoAdd, "{not json")).toBe("Invalid arguments: not valid JSON.");
  });

  it("rejects a non-object (array, null, number)", () => {
    expect(message(todoAdd, "[1,2]")).toBe("Invalid arguments: expected a JSON object.");
    expect(message(todoAdd, null)).toBe("Invalid arguments: expected a JSON object.");
    expect(message(todoDone, 42)).toBe("Invalid arguments: expected a JSON object.");
  });

  it("renames an argAliases key", () => {
    expect(prepareArguments(todoAdd, { text: "Milk" })).toEqual({ title: "Milk" });
    expect(prepareArguments(todoAdd, { title: "Milk", items: "groceries" })).toEqual({ title: "Milk", list: "shopping" });
  });

  it("matches a key with a different case", () => {
    expect(prepareArguments(todoAdd, { TITLE: "Milk", Due: "2026-03-03" })).toEqual({
      title: "Milk",
      due: "2026-03-03",
    });
  });

  it("lets the real name win over its alias", () => {
    expect(prepareArguments(todoAdd, { text: "Alias", title: "Real" })).toEqual({ title: "Real" });
  });

  it("drops keys whose value is null", () => {
    expect(prepareArguments(todoAdd, { title: "Milk", list: null })).toEqual({ title: "Milk" });
  });

  it("coerces '3' to 3 for an integer", () => {
    expect(prepareArguments(todoDone, { id: "3" })).toEqual({ id: 3 });
  });

  it("coerces 'TRUE' to true", () => {
    const t: ToolDef = {
      name: "toggle",
      description: "t",
      parameters: Type.Object({ flag: Type.Boolean() }),
    };
    expect(prepareArguments(t, { flag: "TRUE" })).toEqual({ flag: true });
    expect(prepareArguments(t, { flag: "false" })).toEqual({ flag: false });
  });

  it("coerces 42 to '42' for a string", () => {
    const t: ToolDef = {
      name: "note",
      description: "n",
      parameters: Type.Object({ title: Type.String() }),
    };
    expect(prepareArguments(t, { title: 42 })).toEqual({ title: "42" });
  });

  it("matches an enum by case and by valueAliases", () => {
    expect(prepareArguments(todoAdd, { title: "Milk", list: "Groceries" })).toEqual({
      title: "Milk",
      list: "shopping",
    });
    expect(prepareArguments(todoAdd, { title: "Milk", list: "GARDEN" })).toEqual({
      title: "Milk",
      list: "garden",
    });
    expect(prepareArguments(todoAdd, { title: "Milk", list: "boodschappen" })).toEqual({
      title: "Milk",
      list: "shopping",
    });
  });

  it("returns {} for undefined arguments", () => {
    expect(prepareArguments(todoMaybe, undefined)).toEqual({});
  });

  it("gives each error sentence character for character", () => {
    expect(message(todoAdd, { list: "shopping" })).toBe("Missing argument 'title'.");
    expect(message(todoDone, { id: "three" })).toBe("Argument 'id' must be an integer.");
    const num: ToolDef = {
      name: "scale",
      description: "s",
      parameters: Type.Object({ ratio: Type.Number() }),
    };
    expect(message(num, { ratio: "many" })).toBe("Argument 'ratio' must be a number.");
    const bool: ToolDef = {
      name: "toggle",
      description: "t",
      parameters: Type.Object({ flag: Type.Boolean() }),
    };
    expect(message(bool, { flag: "yes" })).toBe("Argument 'flag' must be true or false.");
    const str: ToolDef = {
      name: "note",
      description: "n",
      parameters: Type.Object({ title: Type.String() }),
    };
    expect(message(str, { title: true })).toBe("Argument 'title' must be text.");
    expect(message(todoAdd, { title: "Milk", list: "office" })).toBe(
      "Argument 'list' must be one of: home, shopping, garden.",
    );
    expect(message(todoDone, { id: 0 })).toBe("Argument 'id' must be at least 1.");
    const bounded: ToolDef = {
      name: "todo_done",
      description: "Mark a todo done.",
      parameters: Type.Object({ id: Type.Integer({ minimum: 1, maximum: 10 }) }),
    };
    expect(message(bounded, { id: 11 })).toBe("Argument 'id' must be at most 10.");
    expect(message(todoAdd, { title: "Milk", colour: "red" })).toBe(
      "Unknown argument 'colour'. todo_add takes: title, list, due.",
    );
  });

  it("joins two errors in property order, then unknown keys", () => {
    expect(message(todoAdd, { title: "Milk", list: "office", colour: "red" })).toBe(
      "Argument 'list' must be one of: home, shopping, garden. Unknown argument 'colour'. todo_add takes: title, list, due.",
    );
  });
});

describe("assertFlat", () => {
  it("accepts a flat tool", () => {
    expect(() => assertFlat(todoAdd)).not.toThrow();
  });

  it("refuses an array property", () => {
    const t: ToolDef = {
      name: "tags",
      description: "t",
      parameters: Type.Object({ labels: Type.Array(Type.String()) }),
    };
    expect(() => assertFlat(t)).toThrow("Tool 'tags': argument 'labels' is not flat.");
  });

  it("refuses a nested object property", () => {
    const t: ToolDef = {
      name: "nested",
      description: "n",
      parameters: Type.Object({ user: Type.Object({ name: Type.String() }) }),
    };
    expect(() => assertFlat(t)).toThrow("Tool 'nested': argument 'user' is not flat.");
  });
});

describe("number coercion", () => {
  it("does not turn an empty or blank string into 0", () => {
    expect(() => prepareArguments(todoDone, { id: "" })).toThrow("Argument 'id' must be an integer.");
    expect(() => prepareArguments(todoDone, { id: "  " })).toThrow("Argument 'id' must be an integer.");
  });

  it("does not read hex or exponent strings as numbers", () => {
    expect(() => prepareArguments(todoDone, { id: "0x10" })).toThrow("Argument 'id' must be an integer.");
    expect(() => prepareArguments(todoDone, { id: "1e2" })).toThrow("Argument 'id' must be an integer.");
  });

  it("still reads a plain number string, with spaces around it", () => {
    expect(prepareArguments(todoDone, { id: " 3 " })).toEqual({ id: 3 });
  });
});
