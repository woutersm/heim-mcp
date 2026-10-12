#!/usr/bin/env node
import { parseArgs } from "node:util";

import { loadCases } from "../eval/cases.ts";
import { connect } from "../eval/connect.ts";
import { replayCase } from "../eval/replay.ts";
import { runModelCase } from "../eval/model.ts";
import { matchCalls } from "../eval/match.ts";
import { createDemoBackend } from "../demo/backend.ts";

const { values } = parseArgs({
  options: {
    replay: { type: "boolean", default: false },
    "base-url": { type: "string", default: "http://localhost:8080/v1" },
    model: { type: "string", default: "local" },
    cases: { type: "string", default: new URL("../../eval/demo-cases.json", import.meta.url).pathname },
  },
});

const file = loadCases(values.cases);

let passed = 0;
for (const c of file.cases) {
  let mismatches: string[];
  const backend = createDemoBackend(file.today);
  const client = await connect(backend);
  try {
    if (values.replay) {
      mismatches = await replayCase(backend, c);
    } else {
      const { calls } = await runModelCase(client, c, file.today, {
        baseUrl: values["base-url"],
        model: values.model,
        apiKey: process.env.OPENAI_API_KEY,
        fetch,
      });
      mismatches = matchCalls(c.calls, calls);
    }
  } finally {
    await client.close();
  }
  if (mismatches.length === 0) {
    passed++;
    console.log(`ok   ${c.id}`);
  } else {
    console.log(`FAIL ${c.id}: ${mismatches.join("; ")}`);
  }
}
console.log(`${passed}/${file.cases.length} cases`);
process.exit(passed === file.cases.length ? 0 : 1);
