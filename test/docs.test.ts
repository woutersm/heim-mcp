import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { connect } from "../src/eval/connect.ts";
import { createDemoBackend, createServer, prepareArguments, ToolError, type ToolDef } from "../src/index.ts";

const root = new URL("../", import.meta.url).pathname;
const readme = readFileSync(root + "README.md", "utf8");
const llms = readFileSync(root + "llms.txt", "utf8");
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8")) as { bin: Record<string, string> };
const demoCases = JSON.parse(readFileSync(root + "eval/demo-cases.json", "utf8")) as {
  today: string;
  cases: { id: string; message: string; calls: { name: string; arguments: Record<string, unknown>; reply: string }[] }[];
};

const backend = createDemoBackend("2026-03-02");
const tools = Object.fromEntries(backend.tools().map((t) => [t.name, t])) as Record<string, ToolDef>;
const toolNames = backend.tools().map((t) => t.name);

function toolErrorMessage(fn: () => unknown): string {
  try {
    fn();
    throw new Error("expected the call to throw");
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    return e.message;
  }
}

/** The lines of the fenced block under `## Error sentences` in the README. */
function readmeErrorLines(): string[] {
  const block = readme.slice(readme.indexOf("## Error sentences"));
  const m = block.match(/```\n([\s\S]*?)```/);
  if (m === null) throw new Error("README has no fenced block under ## Error sentences");
  return m[1].split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

describe("README error block", () => {
  it("has exactly the five sentences the code produces", async () => {
    const lines = readmeErrorLines();
    expect(lines).toHaveLength(5);
    const [missing, integer, enumLine, unknown, unknownTool] = lines;
    expect(missing).toBe(toolErrorMessage(() => prepareArguments(tools.todo_add, {})));
    expect(missing).toBe("Missing argument 'title'.");
    expect(integer).toBe(toolErrorMessage(() => prepareArguments(tools.todo_done, { id: "abc" })));
    expect(integer).toBe("Argument 'id' must be an integer.");
    expect(enumLine).toBe(
      toolErrorMessage(() => prepareArguments(tools.todo_add, { title: "Milk", list: "office" })),
    );
    expect(enumLine).toBe("Argument 'list' must be one of: home, shopping, garden.");
    expect(unknown).toBe(
      toolErrorMessage(() => prepareArguments(tools.todo_add, { title: "Milk", colour: "red" })),
    );
    expect(unknown).toBe("Unknown argument 'colour'. todo_add takes: title, list, due.");
    const server = createServer(backend, { name: "demo", version: "0.1.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "docs", version: "0.1.0" });
    await client.connect(clientSide);
    const res = (await client.callTool({ name: "todo_finish" })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    await client.close();
    await server.close();
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toBe(unknownTool);
  });
});

describe("README demo tools", () => {
  it("names every demo tool in README.md and llms.txt", () => {
    for (const name of toolNames) {
      expect(readme, `README.md should mention ${name}`).toContain(name);
      expect(llms, `llms.txt should mention ${name}`).toContain(name);
    }
  });
});

describe("README eval example", () => {
  it("is in eval/demo-cases.json with the same arguments and reply", () => {
    const block = readme.slice(readme.indexOf("## Eval"));
    const m = block.match(/```json\n([\s\S]*?)```/);
    if (m === null) throw new Error("README has no json block under ## Eval");
    const example = JSON.parse(m[1]) as {
      cases: { id: string; calls: { name: string; arguments: Record<string, unknown>; reply: string }[] }[];
    };
    expect(example.cases, "the README example case should carry an id").toHaveLength(1);
    const shown = example.cases[0];
    const fileCase = demoCases.cases.find((c) => c.id === shown.id);
    expect(fileCase, `eval/demo-cases.json should contain the case '${shown.id}'`).toBeTruthy();
    for (let i = 0; i < shown.calls.length; i++) {
      expect(fileCase!.calls[i].arguments).toEqual(shown.calls[i].arguments);
      expect(fileCase!.calls[i].reply).toBe(shown.calls[i].reply);
    }
  });
});

describe("package.json bin", () => {
  it("names appear in README.md", () => {
    for (const name of Object.keys(pkg.bin)) {
      expect(readme, `README.md should mention ${name}`).toContain(name);
    }
  });
});

describe("llms.txt", () => {
  it("lists every export of src/index.ts", () => {
    const index = readFileSync(root + "src/index.ts", "utf8");
    const names = [...index.matchAll(/export (?:type )?\{ ([^}]+) \}/g)].flatMap((m) =>
      m[1].split(",").map((n) => n.split(" as ")[0].trim()),
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(llms, `llms.txt should document ${name}`).toContain(name);
    }
  });

  it("lists every error sentence", () => {
    const sentences = [
      "Missing argument 'title'.",
      "Argument 'id' must be an integer.",
      "Argument 'list' must be one of: home, shopping, garden.",
      "Unknown argument 'colour'. todo_add takes: title, list, due.",
    ];
    for (const s of sentences) {
      expect(llms, `llms.txt should contain '${s}'`).toContain(s);
    }
    const unknownTool = `Unknown tool 'todo_finish'. Tools: ${toolNames.join(", ")}.`;
    expect(llms).toContain(unknownTool);
  });
});

describe("connect", () => {
  it("still joins a demo client and server", async () => {
    const client = await connect(backend);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(toolNames);
    await client.close();
  });
});
