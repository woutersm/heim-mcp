import Type from "typebox";
import type { ToolBackend, ToolDef } from "../tools.ts";

/**
 * The backend's tools with every argument description removed, as many quick
 * MCP servers ship them. Tool descriptions, enums and optionality stay.
 */
export function withoutDescriptions(backend: ToolBackend): ToolBackend {
  const tools = backend.tools().map((tool): ToolDef => {
    const params = tool.parameters as unknown as { properties: Record<string, object> };
    const properties: Record<string, object> = {};
    for (const [name, prop] of Object.entries(params.properties)) {
      // Copy every descriptor: TypeBox marks optionality on the property object itself.
      const copy = Object.create(Object.getPrototypeOf(prop), Object.getOwnPropertyDescriptors(prop));
      delete copy.description;
      properties[name] = copy;
    }
    return { ...tool, parameters: { ...params, properties } as unknown as ToolDef["parameters"] };
  });
  return { tools: () => tools, call: (name, args) => backend.call(name, args) };
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
