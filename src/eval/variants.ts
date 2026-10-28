import Type from "typebox";
import { ToolError, type ToolBackend, type ToolDef } from "../tools.ts";

/**
 * A copy of `tool` whose argument descriptions `describe` decides: it gets
 * each argument's name and description and returns the new one, or undefined
 * for none. Everything else stays.
 */
function redescribed(tool: ToolDef, describe: (arg: string, description: unknown) => string | undefined): ToolDef {
  const params = tool.parameters as unknown as { properties: Record<string, { description?: unknown }> };
  const properties: Record<string, object> = {};
  for (const [name, prop] of Object.entries(params.properties)) {
    // Copy every descriptor: TypeBox marks optionality on the property object itself.
    const copy = Object.create(Object.getPrototypeOf(prop), Object.getOwnPropertyDescriptors(prop));
    const description = describe(name, prop.description);
    if (description === undefined) delete copy.description;
    else copy.description = description;
    properties[name] = copy;
  }
  return { ...tool, parameters: { ...params, properties } as unknown as ToolDef["parameters"] };
}

/**
 * The backend's tools with every argument description removed, as many quick
 * MCP servers ship them. Tool descriptions, enums and optionality stay.
 */
export function withoutDescriptions(backend: ToolBackend): ToolBackend {
  const tools = backend.tools().map((tool) => redescribed(tool, () => undefined));
  return { tools: () => tools, call: (name, args) => backend.call(name, args) };
}

/** A `title` description that says what goes in it, with an example. */
export const TITLE_HINT =
  "Only the thing to do, without the list or the date: 'Bread' for 'add bread to the shopping list'.";

/** An `id` description that says where the id comes from. */
export const ID_HINT = "The todo's id as todo_list or todo_search shows it; look it up first, never guess it.";

/**
 * The demo tools with sharper argument descriptions: `titleHint` for
 * todo_add's title, `idHint` for the id of todo_done and todo_delete.
 */
export function withHints(backend: ToolBackend, hints: { titleHint?: boolean; idHint?: boolean }): ToolBackend {
  const tools = backend.tools().map((tool) => {
    if (hints.titleHint === true && tool.name === "todo_add")
      return redescribed(tool, (arg, d) => (arg === "title" ? TITLE_HINT : (d as string | undefined)));
    if (hints.idHint === true && (tool.name === "todo_done" || tool.name === "todo_delete"))
      return redescribed(tool, (arg, d) => (arg === "id" ? ID_HINT : (d as string | undefined)));
    return tool;
  });
  return { tools: () => tools, call: (name, args) => backend.call(name, args) };
}

const BY_TITLE: Record<string, string> = { todo_done: "Mark a todo as done", todo_delete: "Delete a todo" };

/**
 * todo_done and todo_delete that take an id or a title. A title is looked up
 * with todo_search: one match is acted on by its id, several or none get a
 * sentence that lists them or says where to look. todo_done looks among open
 * todos first.
 */
export function withTitleLookup(backend: ToolBackend): ToolBackend {
  const tools = backend.tools().map((tool): ToolDef => {
    if (!(tool.name in BY_TITLE)) return tool;
    return {
      ...tool,
      description: `${BY_TITLE[tool.name]}, by id or by title.`,
      parameters: Type.Object({
        id: Type.Optional(Type.Integer({ minimum: 1, description: "The todo's id." })),
        title: Type.Optional(Type.String({ description: "Part of the todo's title, when you don't know the id." })),
      }),
    };
  });
  return {
    tools: () => tools,
    async call(name, args) {
      if (!(name in BY_TITLE) || args.id !== undefined) return backend.call(name, args);
      if (typeof args.title !== "string") throw new ToolError(`${name} needs an id or a title.`);
      const title = args.title;
      const found = String(await backend.call("todo_search", { query: title }))
        .split("\n")
        .map((line) => /^#(\d+) (.+) \([^)]*\)( \[done\])?$/.exec(line))
        .filter((m) => m !== null)
        .map((m) => ({ id: Number(m[1]), title: m[2], done: m[3] !== undefined }));
      const open = found.filter((t) => !t.done);
      const matches = name === "todo_done" && open.length > 0 ? open : found;
      if (matches.length === 0) throw new ToolError(`No todo matches '${title}'. Use todo_list to see the todos.`);
      if (matches.length > 1) {
        const listed = matches.map((t) => `#${t.id} '${t.title}'`).join(", ");
        throw new ToolError(`${matches.length} todos match '${title}': ${listed}. Call ${name} with one id.`);
      }
      return backend.call(name, { id: matches[0].id });
    },
  };
}

const EXTRA_TOOLS: ToolDef[] = [
  {
    name: "note_add",
    description: "Save a note.",
    parameters: Type.Object({ text: Type.String({ description: "The note." }) }),
  },
  {
    name: "calendar_add",
    description: "Add an event to the family calendar.",
    parameters: Type.Object({
      title: Type.String({ description: "What the event is." }),
      date: Type.String({ description: "A date as YYYY-MM-DD." }),
      time: Type.Optional(Type.String({ description: "A time as HH:MM." })),
    }),
  },
  {
    name: "calendar_list",
    description: "List calendar events for a day.",
    parameters: Type.Object({ date: Type.Optional(Type.String({ description: "A date as YYYY-MM-DD." })) }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "weather_get",
    description: "Get the weather forecast.",
    parameters: Type.Object({
      place: Type.Optional(Type.String({ description: "A town." })),
      day: Type.Optional(Type.Enum(["today", "tomorrow"], { description: "Which day." })),
    }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "timer_set",
    description: "Start a kitchen timer.",
    parameters: Type.Object({
      minutes: Type.Integer({ minimum: 1, description: "How long." }),
      label: Type.Optional(Type.String({ description: "What the timer is for." })),
    }),
  },
  {
    name: "light_set",
    description: "Switch a light on or off.",
    parameters: Type.Object({
      room: Type.Enum(["living", "kitchen", "bedroom", "garden"], { description: "Which room." }),
      on: Type.Boolean({ description: "true for on, false for off." }),
    }),
  },
];

/**
 * The backend's tools plus six household tools that answer "Done.", so a
 * model chooses among eleven tools, as an assistant like heim does.
 */
export function withExtraTools(backend: ToolBackend): ToolBackend {
  const tools = [...backend.tools(), ...EXTRA_TOOLS];
  return {
    tools: () => tools,
    call: (name, args) => (EXTRA_TOOLS.some((t) => t.name === name) ? "Done." : backend.call(name, args)),
  };
}

/** Twelve earlier turns of household chat, in Dutch and English, with no todo in them. */
export const HISTORY: { role: "user" | "assistant"; content: string }[] = [
  { role: "user", content: "Goedemorgen! Wat voor weer wordt het vandaag?" },
  { role: "assistant", content: "Goedemorgen. Vandaag is het droog, 9 graden, met in de middag wat zon." },
  { role: "user", content: "Set a timer for the eggs, 7 minutes" },
  { role: "assistant", content: "Timer set: 7 minutes for the eggs." },
  { role: "user", content: "Staat er iets op de kalender voor zaterdag?" },
  { role: "assistant", content: "Zaterdag om 10:00 staat 'zwemles Noor' op de kalender." },
  { role: "user", content: "Doe het licht in de keuken maar uit" },
  { role: "assistant", content: "Het licht in de keuken is uit." },
  { role: "user", content: "Can you note that the plumber comes Thursday afternoon?" },
  { role: "assistant", content: "Noted: the plumber comes Thursday afternoon." },
  { role: "user", content: "Thanks. And how cold will it get tonight?" },
  { role: "assistant", content: "Tonight it drops to about 2 degrees, so frost is possible." },
];
