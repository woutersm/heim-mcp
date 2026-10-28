import type { ToolDef } from "../tools.ts";

const shown = (v: unknown) => JSON.stringify(v);

/**
 * What the argument check changed between what a model sent and what the tool
 * ran with: renamed keys (`text→title`), changed values (`id "4"→4`), dropped
 * nulls, empty strings and unknown keys. Empty when the call ran exactly as sent.
 */
export function describeCorrections(
  tool: ToolDef,
  raw: Record<string, unknown>,
  prepared: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const preparedKeys = Object.keys(prepared);
  for (const [key, value] of Object.entries(raw)) {
    const label = key === key.trim() ? key : shown(key);
    if (value === null) {
      out.push(`${label} null dropped`);
      continue;
    }
    const name = key.trim();
    let target: string | undefined;
    if (name in prepared) target = name;
    else if (tool.argAliases?.[name] !== undefined && tool.argAliases[name] in prepared) target = tool.argAliases[name];
    else target = preparedKeys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (target === undefined) {
      out.push(typeof value === "string" && value.trim() === "" ? `${label} ${shown(value)} dropped` : `${label} dropped`);
      continue;
    }
    if (target !== key) out.push(`${label}→${target}`);
    if (prepared[target] !== value) out.push(`${target} ${shown(value)}→${shown(prepared[target])}`);
  }
  return out;
}
