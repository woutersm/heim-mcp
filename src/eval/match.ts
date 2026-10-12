import type { EvalCall } from "./cases.ts";

const key = (v: unknown): string => String(v).trim().toLowerCase();
const shown = (v: unknown) => JSON.stringify(v);

/**
 * Compares expected and actual tool calls. Returns one line per mismatch:
 * a count difference, then per position a name difference or an expected
 * argument that is missing or different. Extra actual arguments are fine.
 */
export function matchCalls(
  expected: EvalCall[],
  actual: { name: string; arguments: Record<string, unknown> }[],
): string[] {
  const mismatches: string[] = [];
  if (expected.length !== actual.length)
    mismatches.push(`expected ${expected.length} calls, got ${actual.length}`);

  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    const e = expected[i];
    const a = actual[i];
    if (e.name !== a.name) mismatches.push(`call ${i + 1}: expected ${e.name}, got ${a.name}`);
    for (const [arg, value] of Object.entries(e.arguments)) {
      if (!(arg in a.arguments))
        mismatches.push(`call ${i + 1}: argument '${arg}' expected ${shown(value)}, got <absent>`);
      else if (key(value) !== key(a.arguments[arg]))
        mismatches.push(`call ${i + 1}: argument '${arg}' expected ${shown(value)}, got ${shown(a.arguments[arg])}`);
    }
  }
  return mismatches;
}
