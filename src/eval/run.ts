import { createDemoBackend } from "../demo/backend.ts";
import { matchCalls } from "./match.ts";
import { runModelCase, type ModelOptions } from "./model.ts";
import { replayCase } from "./replay.ts";
import { connect } from "./connect.ts";
import type { CaseFileT, EvalCase } from "./cases.ts";

type CaseResult = { status: "ok" | "fail" | "skip"; detail?: string };

/** Runs one case against a fresh backend; a thrown error becomes a FAIL, never stops the run. */
async function runOne(c: EvalCase, today: string, model?: ModelOptions): Promise<CaseResult> {
  if (c.replay_only === true && model !== undefined) return { status: "skip" };
  const backend = createDemoBackend(today);
  const client = await connect(backend);
  try {
    let mismatches: string[];
    if (model === undefined) {
      mismatches = await replayCase(backend, c);
    } else {
      const { calls } = await runModelCase(client, c, today, model);
      mismatches = matchCalls(c.calls, calls, backend.tools());
    }
    if (mismatches.length === 0) return { status: "ok" };
    return { status: "fail", detail: mismatches.join("; ") };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.close();
  }
}

function line(c: EvalCase, r: CaseResult): string {
  if (r.status === "ok") return `ok   ${c.id}`;
  if (r.status === "skip") return `skip ${c.id} (replay only)`;
  return `FAIL ${c.id}: ${r.detail}`;
}

/** Runs every case; model mode when `model` is given, replay otherwise. */
export async function runEval(
  file: CaseFileT,
  model?: ModelOptions,
): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let passed = 0;
  let skipped = 0;
  for (const c of file.cases) {
    const r = await runOne(c, file.today, model);
    if (r.status === "ok") passed++;
    else if (r.status === "skip") skipped++;
    lines.push(line(c, r));
  }
  lines.push(
    model === undefined
      ? `${passed}/${file.cases.length} cases`
      : `${passed}/${file.cases.length - skipped} cases, ${skipped} replay-only skipped`,
  );
  const ran = file.cases.length - skipped;
  return { lines, ok: passed === ran };
}
