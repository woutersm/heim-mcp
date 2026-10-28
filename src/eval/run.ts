import { createDemoBackend } from "../demo/backend.ts";
import { matchCalls } from "./match.ts";
import { runModelCase, type ModelOptions } from "./model.ts";
import { replayCase } from "./replay.ts";
import { connect } from "./connect.ts";
import { plainCall } from "./plain.ts";
import { describeCorrections } from "./corrections.ts";
import { withExtraTools, withHints, withoutDescriptions, withTitleLookup } from "./variants.ts";
import { prepareCall } from "../validate.ts";
import type { PrepareCall } from "../server.ts";
import type { ToolBackend, ToolDef } from "../tools.ts";
import type { CaseFileT, EvalCase } from "./cases.ts";

type CaseResult = {
  /** "info": an unscored case in model mode, shown but not counted. */
  status: "ok" | "fail" | "skip" | "info";
  detail?: string;
  /** Model mode: what the argument check changed in the calls that ran. */
  corrected?: string[];
  /** Model mode: the calls the server turned away, as sent. */
  rejected?: string[];
  ran?: number;
  correctedCalls?: number;
  /** Model mode, unscored cases: the calls that ran, and the model's answer. */
  ranCalls?: string[];
  answer?: string;
};

type ModelCall = { name: string; arguments: Record<string, unknown> };

/**
 * Whether the server ran a call rather than turning it away at the argument
 * check, and what the check changed. A turned-away call is not scored: the
 * model read the error and may have retried, and only what ran counts.
 */
function checkCall(tools: readonly ToolDef[], prepare: PrepareCall, call: ModelCall): string[] | null {
  const tool = tools.find((t) => t.name === call.name);
  if (tool === undefined) return null;
  try {
    return describeCorrections(tool, call.arguments, prepare(tool, call.arguments).args);
  } catch {
    return null;
  }
}

/** The backend, logging each call that reaches it with the arguments it got. */
function recorded(backend: ToolBackend, log: ModelCall[]): ToolBackend {
  return {
    tools: () => backend.tools(),
    call(name, args) {
      log.push({ name, arguments: args });
      return backend.call(name, args);
    },
  };
}

/** Runs one case against a fresh backend; a thrown error becomes a FAIL, never stops the run. */
async function runOne(c: EvalCase, today: string, model?: ModelOptions): Promise<CaseResult> {
  if (c.replay_only === true && model !== undefined) return { status: "skip" };
  // Scored are the calls that reach the todo tools (or the extra ones), with
  // the arguments they got: after the server's check, and after a title lookup.
  const reached: ModelCall[] = [];
  let backend = createDemoBackend(today);
  if (model?.extraTools === true) backend = withExtraTools(backend);
  backend = recorded(backend, reached);
  if (model?.titleLookup === true) backend = withTitleLookup(backend);
  backend = withHints(backend, { titleHint: model?.titleHint, idHint: model?.idHint });
  if (model?.noDescriptions === true) backend = withoutDescriptions(backend);
  const prepare = model?.plain === true ? plainCall : prepareCall;
  const client = await connect(backend, prepare);
  const result: Omit<CaseResult, "status"> = {};
  try {
    let mismatches: string[];
    if (model === undefined) {
      mismatches = await replayCase(backend, c);
    } else {
      const { calls, answer } = await runModelCase(client, c, today, model);
      const sent: ModelCall[] = [];
      result.corrected = [];
      result.rejected = [];
      result.correctedCalls = 0;
      for (const call of calls) {
        const corrections = checkCall(backend.tools(), prepare, call);
        if (corrections === null) {
          result.rejected.push(`${call.name} ${JSON.stringify(call.arguments)}`);
          continue;
        }
        sent.push(call);
        result.corrected.push(...corrections);
        if (corrections.length > 0) result.correctedCalls++;
      }
      result.ran = sent.length;
      if (c.unscored === true) {
        result.ranCalls = sent.map((call) => `${call.name} ${JSON.stringify(call.arguments)}`);
        result.answer = answer.replace(/\s+/g, " ").trim();
        return { status: "info", ...result };
      }
      mismatches = matchCalls(c.calls, reached, backend.tools(), today);
    }
    if (mismatches.length === 0) return { status: "ok", ...result };
    return { status: "fail", detail: mismatches.join("; "), ...result };
  } catch (e) {
    return { status: "fail", detail: e instanceof Error ? e.message : String(e), ...result };
  } finally {
    await client.close();
  }
}

function line(c: EvalCase, r: CaseResult): string {
  if (r.status === "skip") return `skip ${c.id} (replay only)`;
  let text =
    r.status === "info"
      ? `---- ${c.id}: ${r.ranCalls!.length > 0 ? r.ranCalls!.join("; ") : "no call ran"}`
      : r.status === "ok"
        ? `ok   ${c.id}`
        : `FAIL ${c.id}: ${r.detail}`;
  if (r.corrected !== undefined && r.corrected.length > 0) text += ` (corrected: ${r.corrected.join("; ")})`;
  if (r.rejected !== undefined && r.rejected.length > 0) text += ` (rejected: ${r.rejected.join("; ")})`;
  if (r.status === "info") text += ` | answer: ${r.answer}`;
  return text;
}

/** Runs every case; model mode when `model` is given, replay otherwise. */
export async function runEval(
  file: CaseFileT,
  model?: ModelOptions,
): Promise<{ lines: string[]; ok: boolean }> {
  const lines: string[] = [];
  let passed = 0;
  let skipped = 0;
  let unscored = 0;
  let ran = 0;
  let corrected = 0;
  let rejected = 0;
  for (const c of file.cases) {
    const r = await runOne(c, file.today, model);
    if (r.status === "ok") passed++;
    else if (r.status === "skip") skipped++;
    else if (r.status === "info") unscored++;
    ran += r.ran ?? 0;
    corrected += r.correctedCalls ?? 0;
    rejected += r.rejected?.length ?? 0;
    lines.push(line(c, r));
  }
  if (model !== undefined) lines.push(`calls: ${ran} ran, ${corrected} corrected, ${rejected} rejected`);
  const scored = file.cases.length - skipped - unscored;
  lines.push(
    model === undefined
      ? `${passed}/${file.cases.length} cases`
      : `${passed}/${scored} cases, ${skipped} replay-only skipped` + (unscored > 0 ? `, ${unscored} unscored` : ""),
  );
  return { lines, ok: passed === scored };
}
