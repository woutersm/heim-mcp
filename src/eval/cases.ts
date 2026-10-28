import { readFileSync } from "node:fs";
import Type from "typebox";
import Value from "typebox/value";

const EvalCall = Type.Object({
  name: Type.String(),
  arguments: Type.Object({}),
  reply: Type.String(),
  error: Type.Optional(Type.Boolean()),
});

const EvalCase = Type.Object({
  id: Type.String(),
  message: Type.String(),
  calls: Type.Array(EvalCall),
  replay_only: Type.Optional(Type.Boolean()),
  unscored: Type.Optional(Type.Boolean()),
});

export const CaseFile = Type.Object({
  today: Type.String(),
  cases: Type.Array(EvalCase),
});

export type EvalCall = {
  name: string;
  arguments: Record<string, unknown>;
  reply: string;
  error?: boolean;
};
export type EvalCase = {
  id: string;
  message: string;
  calls: EvalCall[];
  replay_only?: boolean;
  /** Model mode prints what ran and the model's answer, and leaves the case out of the score. */
  unscored?: boolean;
};
export type CaseFileT = { today: string; cases: EvalCase[] };

/**
 * Reads and checks a case file. A file that fails the schema throws
 * `Error("<path>: not a case file.")`; duplicate ids throw
 * `Error("<path>: duplicate case id 'x'.")`.
 */
export function loadCases(path: string): CaseFileT {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Value.Check(CaseFile, parsed)) throw new Error(`${path}: not a case file.`);
  const file = parsed as CaseFileT;
  const seen = new Set<string>();
  for (const c of file.cases) {
    if (seen.has(c.id)) throw new Error(`${path}: duplicate case id '${c.id}'.`);
    seen.add(c.id);
  }
  return file;
}
