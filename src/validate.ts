import Value from "typebox/value";
import { ToolError, type ToolDef } from "./tools.ts";

type PropertySchema = Record<string, unknown> & { anyOf?: PropertySchema[] };

type PropType = "string" | "integer" | "number" | "boolean" | "enum";

function enumValues(prop: PropertySchema): string[] | null {
  const enumList = prop.enum;
  if (Array.isArray(enumList) && enumList.every((v) => typeof v === "string")) {
    return enumList as string[];
  }
  if (Array.isArray(prop.anyOf)) {
    const consts = prop.anyOf.map((a) => a.const);
    if (consts.every((v) => typeof v === "string")) return consts as string[];
  }
  return null;
}

/** The declared type of a property, if it is a flat scalar or a string enum. */
function propertyType(prop: PropertySchema): PropType | null {
  if (enumValues(prop) !== null) return "enum";
  const type = prop.type;
  if (type === "string" || type === "integer" || type === "number" || type === "boolean") {
    return type;
  }
  return enumValues(prop) !== null ? "enum" : null;
}

function listAllowed(values: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (!seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      parts.push(v);
    }
  }
  return parts.join(", ");
}

/**
 * Throws a plain `Error` when any property is not a string, integer, number,
 * boolean, or string enum.
 */
export function assertFlat(tool: ToolDef): void {
  const props = (tool.parameters as unknown as { properties: Record<string, PropertySchema> }).properties;
  for (const [key, prop] of Object.entries(props) as [string, PropertySchema][]) {
    if (enumValues(prop) === null && !["string", "integer", "number", "boolean"].includes(String(prop.type))) {
      throw new Error(`Tool '${tool.name}': argument '${key}' is not flat.`);
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/**
 * Turns whatever a model sent into the clean arguments a tool runs with.
 * Throws `ToolError` whose message is one English sentence per problem.
 * An unknown argument is dropped, not an error on its own.
 */
export function prepareArguments(tool: ToolDef, raw: unknown): Record<string, unknown> {
  return prepareCall(tool, raw).args;
}

/**
 * prepareArguments, plus the unknown argument names it dropped, so the server
 * can say after the reply that they were ignored. When the call is rejected
 * for another reason, the unknown names are part of the error instead.
 */
export function prepareCall(tool: ToolDef, raw: unknown): { args: Record<string, unknown>; ignored: string[] } {
  let value: unknown = raw;
  if (raw !== undefined && typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ToolError("Invalid arguments: not valid JSON.");
    }
  }
  if (raw !== undefined && !isPlainObject(value)) {
    throw new ToolError("Invalid arguments: expected a JSON object.");
  }
  // Drop nulls before renaming so a null alias can never remove a real value.
  const obj: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(
    value === undefined ? {} : (value as Record<string, unknown>),
  )) {
    if (val !== null) obj[key] = val;
  }

  const props = (tool.parameters as unknown as { properties: Record<string, PropertySchema> }).properties;
  const names = Object.keys(props);
  const lowerName = new Map(names.map((n) => [n.toLowerCase(), n]));

  // Rename: argAliases keys first, then every other key, so a real name
  // overwrites its alias in either order; the last write for a case-clash
  // wins. Unknown keys keep the order they were sent in.
  const renamed: Record<string, unknown> = {};
  // Names are trimmed first: a model sometimes sends "list\n".
  for (const pass of [0, 1]) {
    for (const [rawKey, val] of Object.entries(obj)) {
      const key = rawKey.trim();
      const isAlias = tool.argAliases?.[key] !== undefined;
      if ((pass === 0) !== isAlias) continue;
      let target: string | undefined = tool.argAliases?.[key];
      if (target === undefined) target = lowerName.get(key.toLowerCase());
      renamed[target ?? key] = val;
    }
  }

  const result: Record<string, unknown> = {};
  const sentences: string[] = [];
  const allowedLists: Record<string, string[]> = {};

  // Per property, in property order: coerce, then validate.
  for (const name of names) {
    const prop = props[name];
    // typebox 1.x marks optionality on the property itself, not via a required array.
    const required = !prop["~optional"];
    let v = renamed[name];
    // An empty or blank string for an optional argument means "not given", like null.
    if (!required && typeof v === "string" && v.trim() === "") v = undefined;
    const present = v !== undefined;
    const type = propertyType(prop);
    const enums = enumValues(prop) ?? [];
    if (enums.length > 0) allowedLists[name] = enums;

    if (type === "integer" || type === "number") {
      // Only a plain decimal: `Number()` would read "" as 0 and "0x10" as 16.
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) v = Number(v.trim());
    } else if (type === "boolean") {
      if (typeof v === "string" && v.toLowerCase() === "true") v = true;
      else if (typeof v === "string" && v.toLowerCase() === "false") v = false;
    } else if (type === "string") {
      if (typeof v === "number") v = String(v);
    } else if (type === "enum") {
      if (typeof v === "string") {
        const s = (v as string).trim();
        const aliases = tool.valueAliases?.[name];
        const hit = aliases ? Object.keys(aliases).find((a) => a.toLowerCase() === s.toLowerCase()) : undefined;
        v = hit !== undefined ? aliases![hit] : enums.find((e) => e.toLowerCase() === s.toLowerCase()) ?? v;
      }
    }

    if (!present || v === undefined) {
      if (required) sentences.push(`Missing argument '${name}'.`);
      continue;
    }

    if (type === "integer" && !Number.isInteger(v as number)) {
      sentences.push(`Argument '${name}' must be an integer.`);
      continue;
    }
    if (type === "number" && !Number.isFinite(v as number)) {
      sentences.push(`Argument '${name}' must be a number.`);
      continue;
    }
    if (type === "boolean" && typeof v !== "boolean") {
      sentences.push(`Argument '${name}' must be true or false.`);
      continue;
    }
    if (type === "string" && typeof v !== "string") {
      sentences.push(`Argument '${name}' must be text.`);
      continue;
    }
    if (type === "enum" && typeof v === "string" && !enums.some((e) => e.toLowerCase() === v.toLowerCase())) {
      sentences.push(`Argument '${name}' must be one of: ${listAllowed(enums)}.`);
      continue;
    }
    if (type === "enum" && typeof v !== "string") {
      sentences.push(`Argument '${name}' must be one of: ${listAllowed(enums)}.`);
      continue;
    }

    if (typeof v === "number" && typeof prop.minimum === "number" && v < prop.minimum) {
      sentences.push(`Argument '${name}' must be at least ${prop.minimum}.`);
      continue;
    }
    if (typeof v === "number" && typeof prop.maximum === "number" && v > prop.maximum) {
      sentences.push(`Argument '${name}' must be at most ${prop.maximum}.`);
      continue;
    }

    result[name] = v;
  }

  // Unknown keys, in the order they were sent: named in an error, otherwise dropped.
  const ignored = Object.keys(renamed).filter((key) => !names.includes(key));
  if (sentences.length > 0) {
    for (const key of ignored) sentences.push(`Unknown argument '${key}'. ${tool.name} takes: ${names.join(", ")}.`);
    throw new ToolError(sentences.join(" "));
  }

  if (!Value.Check(tool.parameters, result)) {
    throw new ToolError(`Invalid arguments for '${tool.name}'.`);
  }

  return { args: result, ignored };
}
