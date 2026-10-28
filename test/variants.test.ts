import { describe, expect, it } from "vitest";
import { createDemoBackend, createServer, prepareArguments, type ToolDef } from "../src/index.ts";
import {
  HISTORY,
  ID_HINT,
  TITLE_EXAMPLE,
  TITLE_HINT,
  withExtraTools,
  withHints,
  withoutDescriptions,
  withTitleLookup,
} from "../src/eval/variants.ts";
import { ToolError } from "../src/tools.ts";

const DEMO = ["todo_add", "todo_list", "todo_done", "todo_delete", "todo_search"];
const props = (t: ToolDef) => (t.parameters as unknown as { properties: Record<string, Record<string, unknown>> }).properties;

describe("withoutDescriptions", () => {
  const backend = withoutDescriptions(createDemoBackend("2026-03-02"));
  const byName = Object.fromEntries(backend.tools().map((t) => [t.name, t]));

  it("removes every argument description and keeps the tool's own", () => {
    for (const t of backend.tools()) {
      for (const p of Object.values(props(t))) expect(p.description).toBeUndefined();
      expect(t.description.length).toBeGreaterThan(0);
    }
    expect(props(byName.todo_add).list.enum).toEqual(["home", "shopping", "garden"]);
  });

  it("keeps optional arguments optional", () => {
    expect(prepareArguments(byName.todo_list, { list: "home" })).toEqual({ list: "home" });
    expect(prepareArguments(byName.todo_add, { title: "Milk" })).toEqual({ title: "Milk" });
  });

  it("leaves the backend's tools untouched and still serves", () => {
    expect(props(createDemoBackend("2026-03-02").tools()[0]).title.description).toBe("What to do.");
    expect(() => createServer(backend, { name: "x", version: "0" })).not.toThrow();
  });
});

describe("withExtraTools", () => {
  const backend = withExtraTools(createDemoBackend("2026-03-02"));

  it("offers the five demo tools and six more household tools", () => {
    expect(backend.tools().map((t) => t.name)).toEqual([
      ...DEMO,
      "note_add",
      "calendar_add",
      "calendar_list",
      "weather_get",
      "timer_set",
      "light_set",
    ]);
    expect(() => createServer(backend, { name: "x", version: "0" })).not.toThrow();
  });

  it("answers an extra tool with 'Done.' and passes demo calls through", async () => {
    expect(await backend.call("timer_set", { minutes: 5 })).toBe("Done.");
    expect(await backend.call("todo_search", { query: "fence" })).toBe("Nothing matches 'fence'.");
  });
});

describe("HISTORY", () => {
  it("is twelve turns, user and assistant in turn", () => {
    expect(HISTORY).toHaveLength(12);
    HISTORY.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? "user" : "assistant"));
  });
});

describe("withTitleLookup", () => {
  const fresh = () => withTitleLookup(createDemoBackend("2026-03-02"));
  const byName = Object.fromEntries(fresh().tools().map((t) => [t.name, t]));

  it("lets todo_done and todo_delete take an id or a title, both optional", () => {
    for (const name of ["todo_done", "todo_delete"]) {
      expect(Object.keys(props(byName[name]))).toEqual(["id", "title"]);
      expect(prepareArguments(byName[name], { title: "kettle" })).toEqual({ title: "kettle" });
      expect(prepareArguments(byName[name], { id: "5" })).toEqual({ id: 5 });
    }
    expect(byName.todo_add).toBe(createDemoBackend("2026-03-02").tools()[0]);
    expect(() => createServer(fresh(), { name: "x", version: "0" })).not.toThrow();
  });

  it("acts on the one todo whose title matches", async () => {
    const backend = fresh();
    expect(await backend.call("todo_done", { title: "kettle" })).toBe("Done: #5 'Descale the kettle'.");
    expect(await backend.call("todo_delete", { title: "Chimney Sweep" })).toBe("Deleted #7 'Book chimney sweep'.");
    expect(await backend.call("todo_delete", { id: 2 })).toBe("Deleted #2 'Oat milk'.");
  });

  it("marks done only among open todos when one matches", async () => {
    const backend = fresh();
    await backend.call("todo_add", { title: "Buy a kettle" });
    await backend.call("todo_done", { id: 9 });
    expect(await backend.call("todo_done", { title: "kettle" })).toBe("Done: #5 'Descale the kettle'.");
    expect(await backend.call("todo_done", { title: "bulb" })).toBe("#6 'Replace hallway bulb' was already done.");
  });

  it("answers with one sentence when the title matches several todos, none, or is missing", async () => {
    const backend = fresh();
    const error = async (name: string, args: Record<string, unknown>) => {
      try {
        await backend.call(name, args);
      } catch (e) {
        expect(e).toBeInstanceOf(ToolError);
        return (e as Error).message;
      }
      throw new Error("no error");
    };
    expect(await error("todo_done", { title: "the" })).toBe(
      "3 todos match 'the': #3 'Fix the gate latch', #4 'Prune the apple tree', #5 'Descale the kettle'. Call todo_done with one id.",
    );
    expect(await error("todo_delete", { title: "fence" })).toBe("No todo matches 'fence'. Use todo_list to see the todos.");
    expect(await error("todo_done", {})).toBe("todo_done needs an id or a title.");
  });
});

describe("withHints", () => {
  const byName = (titleHint: boolean, idHint: boolean, titleExample = false) =>
    Object.fromEntries(
      withHints(createDemoBackend("2026-03-02"), { titleHint, idHint, titleExample })
        .tools()
        .map((t) => [t.name, t]),
    );

  it("replaces the title description of todo_add", () => {
    const tools = byName(true, false);
    expect(props(tools.todo_add).title.description).toBe(TITLE_HINT);
    expect(props(tools.todo_done).id.description).toBe("The todo's id.");
    expect(prepareArguments(tools.todo_add, { title: "Milk" })).toEqual({ title: "Milk" });
  });

  it("adds an example to the title description when asked", () => {
    expect(TITLE_EXAMPLE.startsWith(TITLE_HINT.slice(0, -1))).toBe(true);
    expect(TITLE_EXAMPLE).toContain("'Bread' for 'add bread to the shopping list'");
    expect(props(byName(false, false, true).todo_add).title.description).toBe(TITLE_EXAMPLE);
    expect(props(byName(true, false, true).todo_add).title.description).toBe(TITLE_EXAMPLE);
  });

  it("replaces the id description of todo_done and todo_delete", () => {
    const tools = byName(false, true);
    expect(props(tools.todo_done).id.description).toBe(ID_HINT);
    expect(props(tools.todo_delete).id.description).toBe(ID_HINT);
    expect(props(tools.todo_add).title.description).toBe("What to do.");
  });
});
