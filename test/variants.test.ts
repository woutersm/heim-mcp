import { describe, expect, it } from "vitest";
import { createDemoBackend, createServer, prepareArguments, type ToolDef } from "../src/index.ts";
import { HISTORY, withExtraTools, withoutDescriptions } from "../src/eval/variants.ts";

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
