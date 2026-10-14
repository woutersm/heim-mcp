import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createDemoBackend } from "../src/demo/backend.ts";
import { createServer } from "../src/server.ts";

const TODAY = "2026-03-02";

async function connect(today: string = TODAY) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(createDemoBackend(today ?? TODAY), { name: "demo", version: "0.1.0" });
  await server.connect(serverSide);
  const client = new Client({ name: "eval", version: "0.1.0" });
  await client.connect(clientSide);
  return { client, server };
}

function text(res: { content: unknown; isError?: boolean }): string {
  return ((res.content as Array<{ type: string; text?: string }>)[0]).text as string;
}

async function call(client: Client, name: string, args?: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as { content: unknown; isError?: boolean };
}

describe("demo fixtures, through the MCP client", () => {
  it("lists the open shopping todos in id order", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_list", { list: "shopping" });
      expect(res.isError).not.toBe(true);
      expect(text(res)).toBe("#1 Buy dish soap (shopping, due 2026-03-02)\n#2 Oat milk (shopping)");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("lists the done todos with a trailing [done]", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_list", { done: true });
      expect(res.isError).not.toBe(true);
      expect(text(res)).toBe(
        "#6 Replace hallway bulb (home) [done]\n#8 Coffee beans (shopping) [done]",
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers 'Nothing on the list.' when the filter matches nothing", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_list", { list: "garden", done: true });
      expect(res.isError).not.toBe(true);
      expect(text(res)).toBe("Nothing on the list.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("adds a todo with a due date, and a default list of home", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_add", { title: "Milk", list: "shopping", due: "2026-03-03" });
      expect(res.isError).not.toBe(true);
      expect(text(res)).toBe("Added #9 'Milk' to shopping, due 2026-03-03.");

      const plain = await call(client, "todo_add", { title: "Broom" });
      expect(plain.isError).not.toBe(true);
      expect(text(plain)).toBe("Added #10 'Broom' to home.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("resolves 'tomorrow' against today and takes a title from the alias 'text'", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_add", { text: "Flowers", list: "garden", due: "tomorrow" });
      expect(res.isError).not.toBe(true);
      expect(text(res)).toBe("Added #9 'Flowers' to garden, due 2026-03-03.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects an invalid due with the exact sentence", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_add", { title: "Milk", due: "next week" });
      expect(res.isError).toBe(true);
      expect(text(res)).toBe("Argument 'due' must be a date as YYYY-MM-DD, 'today' or 'tomorrow'.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("maps the list values 'Groceries' and 'tuin'", async () => {
    const { client, server } = await connect();
    try {
      const g = await call(client, "todo_add", { title: "Eggs", list: "Groceries" });
      expect(g.isError).not.toBe(true);
      expect(text(g)).toBe("Added #9 'Eggs' to shopping.");

      const t = await call(client, "todo_add", { title: "Water the herbs", list: "tuin" });
      expect(t.isError).not.toBe(true);
      expect(text(t)).toBe("Added #10 'Water the herbs' to garden.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("accepts a string id for todo_done and reports an already-done todo", async () => {
    const { client, server } = await connect();
    try {
      const ok = await call(client, "todo_done", { id: "3" });
      expect(ok.isError).not.toBe(true);
      expect(text(ok)).toBe("Done: #3 'Fix the gate latch'.");

      const again = await call(client, "todo_done", { todo: "6" });
      expect(again.isError).not.toBe(true);
      expect(text(again)).toBe("#6 'Replace hallway bulb' was already done.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("answers an unknown id with the exact sentence", async () => {
    const { client, server } = await connect();
    try {
      const res = await call(client, "todo_done", { id: 42 });
      expect(res.isError).toBe(true);
      expect(text(res)).toBe("No todo #42. Use todo_list to see the ids.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("deletes a todo and then lists it as gone", async () => {
    const { client, server } = await connect();
    try {
      const del = await call(client, "todo_delete", { todo_id: 5 });
      expect(del.isError).not.toBe(true);
      expect(text(del)).toBe("Deleted #5 'Descale the kettle'.");

      const list = await call(client, "todo_list", { list: "home" });
      expect(list.isError).not.toBe(true);
      expect(text(list)).toBe("#7 Book chimney sweep (home, due 2026-03-10)");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("finds done todos in the search and reports a miss", async () => {
    const { client, server } = await connect();
    try {
      const hit = await call(client, "todo_search", { q: "hallway" });
      expect(hit.isError).not.toBe(true);
      expect(text(hit)).toBe("#6 Replace hallway bulb (home) [done]");

      const miss = await call(client, "todo_search", { query: "xyz" });
      expect(miss.isError).not.toBe(true);
      expect(text(miss)).toBe("Nothing matches 'xyz'.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("never gives a deleted todo's id to a new todo", async () => {
    const { client, server } = await connect();
    try {
      const add = await call(client, "todo_add", { title: "Milk" });
      expect(add.isError).not.toBe(true);
      expect(text(add)).toBe("Added #9 'Milk' to home.");

      const del = await call(client, "todo_delete", { id: 9 });
      expect(del.isError).not.toBe(true);
      expect(text(del)).toBe("Deleted #9 'Milk'.");

      const bread = await call(client, "todo_add", { title: "Bread" });
      expect(bread.isError).not.toBe(true);
      expect(text(bread)).toBe("Added #10 'Bread' to home.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("resolves 'tomorrow' against the clock at each call when no today is given", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 2, 2, 23, 0)); // local time; sv-SE gives 2026-03-02
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      const server = createServer(createDemoBackend(), { name: "demo", version: "0.1.0" });
      await server.connect(serverSide);
      const client = new Client({ name: "eval", version: "0.1.0" });
      await client.connect(clientSide);
      try {
        const first = await call(client, "todo_add", { title: "Milk", due: "tomorrow" });
        expect(first.isError).not.toBe(true);
        expect(text(first)).toBe("Added #9 'Milk' to home, due 2026-03-03.");

        vi.setSystemTime(new Date(2026, 2, 3, 1, 0)); // past midnight: 2026-03-03
        const second = await call(client, "todo_add", { title: "Bread", due: "tomorrow" });
        expect(second.isError).not.toBe(true);
        expect(text(second)).toBe("Added #10 'Bread' to home, due 2026-03-04.");
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows destructiveHint: true on todo_delete only", async () => {
    const { client, server } = await connect();
    try {
      const res = await client.listTools();
      const hints = Object.fromEntries(res.tools.map((t) => [t.name, t.annotations]));
      expect(hints["todo_add"]).toEqual({ readOnlyHint: false, destructiveHint: false });
      expect(hints["todo_list"]).toEqual({ readOnlyHint: true });
      expect(hints["todo_done"]).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
      expect(hints["todo_delete"]).toEqual({ readOnlyHint: false, destructiveHint: true });
      expect(hints["todo_search"]).toEqual({ readOnlyHint: true });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
