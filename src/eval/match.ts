import type { ToolDef } from "../tools.ts";
import { prepareArguments } from "../validate.ts";
import type { EvalCall } from "./cases.ts";

const key = (v: unknown): string => String(v).trim().toLowerCase();

/** The date a day word stands for, relative to `today`; any other value as `key` gives it. */
function dayKey(v: unknown, today: string | undefined): string {
  const k = key(v);
  if (today === undefined) return k;
  if (k === "today") return today;
  if (k === "tomorrow") {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return k;
}
const shown = (v: unknown) => JSON.stringify(v);

/**
 * Runs a call's arguments through prepareArguments for its tool, when the
 * tool exists and the normalisation does not throw; otherwise returns them
 * as they are.
 */
function prepared(
  tools: readonly ToolDef[],
  name: string,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) return arguments_;
  try {
    return prepareArguments(tool, arguments_);
  } catch {
    return arguments_;
  }
}

/**
 * Compares expected and actual tool calls. Both sides first go through
 * prepareArguments, so a call written with aliases and alias values matches
 * a strict call. Extra actual calls of a read-only tool that no expected
 * call names are ignored; a read-only call a case expects is still required.
 * After that: a count difference, then per position a name difference or an
 * expected argument that is missing or different, values compared as
 * trimmed, lower-cased strings. Extra actual arguments are fine. Given the
 * case file's `today`, "today" and "tomorrow" match their dates as YYYY-MM-DD.
 */
export function matchCalls(
  expected: EvalCall[],
  actual: { name: string; arguments: Record<string, unknown> }[],
  tools: readonly ToolDef[],
  today?: string,
): string[] {
  const mismatches: string[] = [];

  const expectedNames = new Set(expected.map((c) => c.name));
  const remaining = actual.filter(
    (a) => !tools.find((t) => t.name === a.name)?.annotations?.readOnlyHint || expectedNames.has(a.name),
  );

  if (expected.length !== remaining.length)
    mismatches.push(`expected ${expected.length} calls, got ${remaining.length}`);

  for (let i = 0; i < Math.min(expected.length, remaining.length); i++) {
    const e = prepared(tools, expected[i].name, expected[i].arguments);
    const a = prepared(tools, remaining[i].name, remaining[i].arguments);
    if (expected[i].name !== remaining[i].name)
      mismatches.push(`call ${i + 1}: expected ${expected[i].name}, got ${remaining[i].name}`);
    for (const [arg, value] of Object.entries(e)) {
      if (!(arg in a))
        mismatches.push(`call ${i + 1}: argument '${arg}' expected ${shown(value)}, got <absent>`);
      else if (dayKey(value, today) !== dayKey(a[arg], today))
        mismatches.push(`call ${i + 1}: argument '${arg}' expected ${shown(value)}, got ${shown(a[arg])}`);
    }
  }
  return mismatches;
}
