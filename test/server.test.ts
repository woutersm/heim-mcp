import { afterEach, describe, expect, it, vi } from "vitest";
import Type from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.ts";
import { ToolError, type ToolBackend, type ToolDef } from "../src/index.ts";

const todoAdd: ToolDef = {
  name: "todo_add",
  description: "Add a todo.",
  parameters: Type.Object({
    title: Type.String(),
    list: Type.Optional(Type.Enum(["home", "shopping", "garden"])),
  }),
  annotations: { readOnlyHint: false },
  argAliases: { text: "title" },
};

const todoList: ToolDef = {
  name: "todo_list",
  description: "List todos.",
  parameters: Type.Object({
    list: Type.Optional(Type.Enum(["home", "shopping", "garden"])),
  }),
};

function makeBackend(): ToolBackend {
  return {
    tools: () => [todoAdd, todoList],
    call(name: string, args: Record<string, unknown>) {
      if (name === "todo_add") {
        if (args.title === "Boom") throw new ToolError("Title 'Boom' is not allowed.");
        if (args.title === "Blow") throw new Error("secret internal failure 42");
        return `Added '${args.title}'.`;
      }
      if (name === "todo_list") return "1: Milk";
      throw new Error(`unreachable ${name}`);
    },
  };
}

async function connect(backend: ToolBackend) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(backend, { name: "demo", version: "0.1.0" });
  await server.connect(serverSide);
  const client = new Client({ name: "eval", version: "0.1.0" });
  await client.connect(clientSide);
  return { client, server };
}

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("tools/list", () => {
  it("returns the tools in backend order with their JSON schema", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.listTools();
      expect(res.tools.map((t) => t.name)).toEqual(["todo_add", "todo_list"]);
      expect(res.tools[0].description).toBe("Add a todo.");
      expect(res.tools[0].inputSchema).toEqual(JSON.parse(JSON.stringify(todoAdd.parameters)));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("includes annotations only on the tool that has them", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.listTools();
      expect(res.tools[0].annotations).toEqual({ readOnlyHint: false });
      expect(res.tools[1].annotations).toBeUndefined();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("tools/call", () => {
  it("returns the backend's text on a good call", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.callTool({ name: "todo_add", arguments: { title: "Milk" } });
      expect(res.isError).not.toBe(true);
      expect(res.content).toEqual([{ type: "text", text: "Added 'Milk'." }]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers an unknown tool without rejecting", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.callTool({ name: "todo_finish" });
      expect(res.isError).toBe(true);
      expect(res.content).toEqual([
        { type: "text", text: "Unknown tool 'todo_finish'. Tools: todo_add, todo_list." },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a validation error as isError text", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.callTool({ name: "todo_list", arguments: { list: "office" } });
      expect(res.isError).toBe(true);
      expect(res.content).toEqual([
        { type: "text", text: "Argument 'list' must be one of: home, shopping, garden." },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("parses arguments sent as a JSON string", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.request(
        { method: "tools/call", params: { name: "todo_add", arguments: '{"title":"Milk"}' } } as never,
        CallToolResultSchema,
      );
      expect(res.isError).not.toBe(true);
      expect(res.content).toEqual([{ type: "text", text: "Added 'Milk'." }]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers null and array arguments with the Invalid arguments sentence", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      for (const args of [null, [1]]) {
        const res = await client.request(
          { method: "tools/call", params: { name: "todo_add", arguments: args } } as never,
          CallToolResultSchema,
        );
        expect(res.isError).toBe(true);
        expect(res.content).toEqual([
          { type: "text", text: "Invalid arguments: expected a JSON object." },
        ]);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a ToolError from call as isError text", async () => {
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.callTool({ name: "todo_add", arguments: { title: "Boom" } });
      expect(res.isError).toBe(true);
      expect(res.content).toEqual([{ type: "text", text: "Title 'Boom' is not allowed." }]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a plain Error from call as an internal-error sentence", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, server } = await connect(makeBackend());
    try {
      const res = await client.callTool({ name: "todo_add", arguments: { title: "Blow" } });
      expect(res.isError).toBe(true);
      expect(res.content).toEqual([
        { type: "text", text: "The tool 'todo_add' failed with an internal error." },
      ]);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const line = String(errSpy.mock.calls[0][0]);
      expect(line).not.toContain("secret internal failure 42");
      expect(line).toContain("todo_add");
    } finally {
      await client.close();
      await server.close();
    }
  }, );
});

describe("createServer", () => {
  it("throws on a duplicate tool name", () => {
    const backend: ToolBackend = {
      tools: () => [
        { name: "a", description: "a", parameters: Type.Object({}) },
        { name: "a", description: "a", parameters: Type.Object({}) },
      ],
      call: () => "ok",
    };
    expect(() => createServer(backend, { name: "demo", version: "0.1.0" })).toThrow(
      "Duplicate tool 'a'.",
    );
  });

  it("throws on a non-flat tool", () => {
    const backend: ToolBackend = {
      tools: () => [
        { name: "x", description: "x", parameters: Type.Object({ tags: Type.Array(Type.String()) }) },
      ],
      call: () => "ok",
    };
    expect(() => createServer(backend, { name: "demo", version: "0.1.0" })).toThrow();
  });
});
