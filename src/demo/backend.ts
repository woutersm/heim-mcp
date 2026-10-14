import Type from "typebox";
import { ToolError, type ToolBackend, type ToolDef } from "../tools.ts";
import { FIXTURES, type FixtureTodo } from "./fixtures.ts";

const LIST_ALIASES: Record<string, string> = {
  groceries: "shopping",
  boodschappen: "shopping",
  house: "home",
  thuis: "home",
  tuin: "garden",
};

const listEnum = Type.Enum(["home", "shopping", "garden"], {
  description: "Which list: home, shopping or garden.",
});

function tomorrowOf(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function parseDue(due: string, today: () => string): string {
  const s = due.trim().toLowerCase();
  if (s === "today") return today();
  if (s === "tomorrow") return tomorrowOf(today());
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00Z");
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) return s;
  }
  throw new ToolError("Argument 'due' must be a date as YYYY-MM-DD, 'today' or 'tomorrow'.");
}

function todoLine(todo: FixtureTodo): string {
  const parts: string[] = [todo.list];
  if (todo.due !== null) parts.push(`due ${todo.due}`);
  return `#${todo.id} ${todo.title} (${parts.join(", ")})${todo.done ? " [done]" : ""}`;
}

const TOOLS: ToolDef[] = [
  {
    name: "todo_add",
    description: "Add a todo.",
    parameters: Type.Object({
      title: Type.String({ description: "What to do." }),
      list: Type.Optional(listEnum),
      due: Type.Optional(Type.String({ description: "A date as YYYY-MM-DD, 'today' or 'tomorrow'." })),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false },
    argAliases: { text: "title", name: "title", date: "due", when: "due", category: "list" },
    valueAliases: { list: LIST_ALIASES },
  },
  {
    name: "todo_list",
    description: "List open todos, optionally for one list, or the done ones.",
    parameters: Type.Object({
      list: Type.Optional(listEnum),
      done: Type.Optional(Type.Boolean({ description: "Show done todos instead of open ones. Defaults to false." })),
    }),
    annotations: { readOnlyHint: true },
    valueAliases: { list: LIST_ALIASES },
  },
  {
    name: "todo_done",
    description: "Mark a todo as done.",
    parameters: Type.Object({ id: Type.Integer({ minimum: 1, description: "The todo's id." }) }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    argAliases: { todo_id: "id", todo: "id" },
  },
  {
    name: "todo_delete",
    description: "Delete a todo.",
    parameters: Type.Object({ id: Type.Integer({ minimum: 1, description: "The todo's id." }) }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    argAliases: { todo_id: "id", todo: "id" },
  },
  {
    name: "todo_search",
    description: "Find todos whose title contains the query.",
    parameters: Type.Object({ query: Type.String({ description: "Text to look for in the titles." }) }),
    annotations: { readOnlyHint: true },
    argAliases: { q: "query", text: "query" },
  },
];

export function createDemoBackend(today?: string): ToolBackend {
  const todos: FixtureTodo[] = FIXTURES.map((t) => ({ ...t }));
  const now = () => today ?? new Date().toLocaleDateString("sv-SE");
  let idCounter = todos.reduce((max, t) => Math.max(max, t.id), 0);

  const byId = (id: number) => todos.find((t) => t.id === id);

  return {
    tools: () => TOOLS,
    call(name: string, args: Record<string, unknown>): string {
      if (name === "todo_add") {
        const title = args.title as string;
        const list = (args.list as FixtureTodo["list"] | undefined) ?? "home";
        let due: string | null = null;
        if (typeof args.due === "string") due = parseDue(args.due, now);
        idCounter += 1;
        const id = idCounter;
        todos.push({ id, title, list, due, done: false });
        return `Added #${id} '${title}' to ${list}${due !== null ? `, due ${due}` : ""}.`;
      }
      if (name === "todo_list") {
        const list = args.list as string | undefined;
        const done = (args.done as boolean | undefined) ?? false;
        const matches = todos
          .filter((t) => (list === undefined || t.list === list) && t.done === done)
          .sort((a, b) => a.id - b.id)
          .map(todoLine);
        return matches.length > 0 ? matches.join("\n") : "Nothing on the list.";
      }
      if (name === "todo_done" || name === "todo_delete") {
        const id = args.id as number;
        const todo = byId(id);
        if (todo === undefined) throw new ToolError(`No todo #${id}. Use todo_list to see the ids.`);
        if (name === "todo_done") {
          if (todo.done) return `#${todo.id} '${todo.title}' was already done.`;
          todo.done = true;
          return `Done: #${todo.id} '${todo.title}'.`;
        }
        todos.splice(todos.indexOf(todo), 1);
        return `Deleted #${todo.id} '${todo.title}'.`;
      }
      if (name === "todo_search") {
        const raw = args.query as string;
        const q = raw.toLowerCase();
        const matches = todos
          .filter((t) => t.title.toLowerCase().includes(q))
          .sort((a, b) => a.id - b.id)
          .map(todoLine);
        return matches.length > 0 ? matches.join("\n") : `Nothing matches '${raw}'.`;
      }
      throw new Error(`No such tool '${name}'.`);
    },
  };
}
