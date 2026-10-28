#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { loadCases } from "../eval/cases.ts";
import { runEval } from "../eval/run.ts";
import type { ModelOptions } from "../eval/model.ts";

const { values } = parseArgs({
  options: {
    replay: { type: "boolean", default: false },
    plain: { type: "boolean", default: false },
    "reasoning-effort": { type: "string" },
    "no-descriptions": { type: "boolean", default: false },
    "extra-tools": { type: "boolean", default: false },
    history: { type: "boolean", default: false },
    "title-lookup": { type: "boolean", default: false },
    "title-hint": { type: "boolean", default: false },
    "id-hint": { type: "boolean", default: false },
    "base-url": { type: "string", default: "http://localhost:8080/v1" },
    model: { type: "string", default: "local" },
    cases: {
      type: "string",
      default: fileURLToPath(new URL("../../eval/demo-cases.json", import.meta.url)),
    },
  },
});

const file = loadCases(values.cases);

const model: ModelOptions | undefined = values.replay
  ? undefined
  : {
      baseUrl: values["base-url"],
      model: values.model,
      apiKey: process.env.OPENAI_API_KEY,
      fetch,
      plain: values.plain,
      reasoningEffort: values["reasoning-effort"],
      noDescriptions: values["no-descriptions"],
      extraTools: values["extra-tools"],
      history: values.history,
      titleLookup: values["title-lookup"],
      titleHint: values["title-hint"],
      idHint: values["id-hint"],
    };

const { lines, ok } = await runEval(file, model);
for (const line of lines) console.log(line);
process.exit(ok ? 0 : 1);
