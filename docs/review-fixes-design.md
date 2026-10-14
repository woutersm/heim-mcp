# Design: review fixes, and a model mode that measures something

A code review of heim-mcp found ten bugs, and a first model-mode run against Qwen scored 3/15
for the wrong reasons: the eval cases are written for replay, with deliberately sloppy
arguments and deliberate mistakes, and model mode required the model to repeat them. This
design fixes the ten bugs and makes model mode compare what the model meant.

Decisions, for every phase:

| Topic | Decision |
| --- | --- |
| Source imports | source files import each other with the `.ts` extension (`import { x } from "./tools.ts"`) |
| Tests | vitest, in `test/`. No test touches the network, spawns a process, or starts a server. A client and a server are joined with `connect(backend)` from `src/eval/connect.ts` (it returns a connected `Client`; `await client.close()` closes both ends) |
| stdout | no `console.log` in `src/` outside `src/bin/eval.ts` |
| Dependencies | add none |
| Errors | every failure a model reads is an MCP result with `isError: true` and one English sentence |
| README | `README.md` changes only with `test/docs.test.ts` green; it checks the README's tool names, error sentences, eval example and bin names against the code |

---

## Phase 1: The server and the validator keep the README's promise

Three bugs, each with a test written first.

**1. `tools/call` must accept any `arguments`.** The README promises that arguments sent as a
JSON string are parsed, and that a non-object gets the sentence `Invalid arguments: expected a
JSON object.` Today neither reaches the model: the SDK's `Server.setRequestHandler` wraps every
`tools/call` handler with its own strict `CallToolRequestSchema` check (`arguments` must be a
record), so a string, `null` or array comes back as a JSON-RPC error before `prepareArguments`
runs. Registering through the base `Protocol` method skips that wrapper. This was run against
SDK 1.30.1 and passes typecheck and the existing tests:

```ts
import { Protocol } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// The SDK's Server.setRequestHandler checks tools/call against its strict schema
// (arguments must be a record); the base Protocol method lets prepareArguments see
// a string, null or array and answer with a sentence.
const LenientCallToolRequestSchema = z.object({
  method: z.literal("tools/call"),
  params: z.object({ name: z.string(), arguments: z.unknown().optional() }),
});

Protocol.prototype.setRequestHandler.call(server, LenientCallToolRequestSchema, async (req: z.infer<typeof LenientCallToolRequestSchema>) => {
  // the existing handler body, unchanged
});
```

`CallToolRequestSchema` is then no longer imported. A test cannot send a string through
`client.callTool` (its type refuses it); send the raw request instead:

```ts
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
const res = await client.request(
  { method: "tools/call", params: { name: "todo_add", arguments: '{"title":"Milk"}' } } as never,
  CallToolResultSchema,
);
```

`null` arguments keep failing with `Invalid arguments: expected a JSON object.`: the existing
validate test pins that, and the fix is that the sentence now reaches the model.

**2. The real name always wins over its alias, in any key order.** Today the rename loop in
`prepareArguments` is last-write-wins, so `{ "title": "Real", "text": "Alias" }` becomes
`{ title: "Alias" }`, and `{ "title": "Milk", "text": null }` loses the title and fails with
`Missing argument 'title'.` Fix: drop `null` values from the incoming object before renaming,
then write the keys that are `argAliases` first and every other key after, so a real name
overwrites its alias. Unknown keys keep their sent order in the `Unknown argument` sentence.

**3. A string enum written as `{ type: "string", enum: [...] }` is an enum.** `propertyType`
looks at `type` first and returns `"string"` for this form, so `valueAliases`, case-insensitive
matching and the `must be one of` sentence never apply to it. Fix: return `"enum"` when
`enumValues(prop)` is not null, before looking at `type`. In a test, declare such a property
with `Type.Unsafe<string>({ type: "string", enum: ["home", "shopping", "garden"] })`;
`Value.Check` accepts `"shopping"` for it and refuses `"school"`.

**Where:**
- `src/server.ts` 1-4 — imports; 40-62 — the `tools/call` handler
- `src/validate.ts` 21-27 — `propertyType`; 80-92 — the rename loop and the null drop
- `test/server.test.ts` 1-55 — `todoAdd`, `makeBackend()`, `connect()`; copy a test from 109-121
- `test/validate.test.ts` 40-80 — `todoAdd`, `message()`, the alias and null tests

Tests first:
- `test/server.test.ts`: arguments `'{"title":"Milk"}'` (a string) give the text `Added 'Milk'.`
  without `isError`; arguments `null` and `[1]` each give `isError: true` and the text
  `Invalid arguments: expected a JSON object.`
- `test/validate.test.ts`: `{ title: "Real", text: "Alias" }` gives `{ title: "Real" }`;
  `{ title: "Milk", text: null }` gives `{ title: "Milk" }`; for a tool whose `list` is the
  `Type.Unsafe` enum above with `valueAliases: { list: { groceries: "shopping" } }`, `"Groceries"`
  gives `shopping`, `"HOME"` gives `home`, and `"school"` fails with
  `Argument 'list' must be one of: home, shopping, garden.`

### Exit criteria
- A JSON-string `arguments` sent over MCP reaches the tool parsed
- `null` and array `arguments` sent over MCP get an `isError` result with `Invalid arguments: expected a JSON object.`
- The real argument name wins over its alias whichever is sent first, and a `null` alias never removes a real value
- A `{ type: "string", enum }` property gets value aliases, case-insensitive matching and the `must be one of` sentence
- Only `src/server.ts`, `src/validate.ts`, `test/server.test.ts`, `test/validate.test.ts` and `docs/decisions.md` are edited

### Gate
```
npm run typecheck && npm test && npm run build
```

---

## Phase 2: matchCalls compares what the model meant

Model mode compares the model's calls with a case's expected calls. The cases are written for
replay, with sloppy arguments on purpose: `add-with-alias-and-day-word` expects
`{ "text": "Milk", "list": "Groceries" }`, so a model that sends the correct
`{ "title": "Milk", "list": "shopping" }` fails. Two changes to `matchCalls`, and one to the
model loop.

**1. Normalise both sides.** `matchCalls` takes the tools as a third, required argument:

```ts
export function matchCalls(
  expected: EvalCall[],
  actual: { name: string; arguments: Record<string, unknown> }[],
  tools: readonly ToolDef[],
): string[]
```

Before comparing, run each call's arguments, expected and actual, through
`prepareArguments(tool, args)` for the tool of that name. When there is no tool of that name,
or `prepareArguments` throws, compare the arguments as they are. The comparison after that is
unchanged: same mismatch lines, values compared as trimmed, lower-cased strings, extra actual
arguments allowed.

**2. Ignore extra lookups.** A model may look something up first: for
`done-then-done-again`, Qwen called `todo_search` before `todo_done`, which is sensible. Before
comparing, drop each actual call whose tool has `annotations.readOnlyHint === true` *and*
whose name appears in no expected call. A read-only call the case expects must still be made:
`list-open-garden` expects one `todo_list` and still fails with zero calls.

**3. Non-object JSON from the model.** In `runModelCase`, `function.arguments` that parses but
is not a plain object (`"null"`, `"[]"`, `"5"`) is passed on today and crashes the run. Treat it
like unparseable JSON: send back the tool message
`Invalid arguments: expected a JSON object.`, record the call with arguments `{}`, and do not
call the tool.

In `src/bin/eval.ts`, pass `backend.tools()` as the third argument. In `llms.txt` line 28,
update the `matchCalls` signature and say that both sides go through `prepareArguments` and
that unexpected read-only calls are ignored.

**Where:**
- `src/eval/match.ts` 1-31 — all of `matchCalls`
- `src/eval/model.ts` 58-79 — the tool-call loop; 62-70 is the invalid-JSON path to mirror
- `src/bin/eval.ts` 37 — the one caller
- `src/demo/backend.ts` 40-84 — the demo `TOOLS`: `todo_list` and `todo_search` are read-only
- `test/match.test.ts` 1-71 — `add()`; every existing test
- `test/model.test.ts` 104-125 — the invalid-JSON test; copy it

Existing tests in `test/match.test.ts` pass `createDemoBackend("2026-03-02").tools()` as the
third argument; every one keeps its expected result except "reports a name difference per
position": its actual `todo_list` call is now an ignored lookup, so change that actual call
to `{ name: "todo_delete", arguments: { list: "shopping" } }` and its expected line to
`call 1: expected todo_add, got todo_delete`.

Tests first:
- `test/match.test.ts`: expected `{ text: "Milk", list: "Groceries", due: "tomorrow" }` matches
  actual `{ title: "Milk", list: "shopping", due: "tomorrow" }`; expected `{ id: "4" }` for
  `todo_done` matches actual `{ id: 4 }`; expected `[todo_done {id: 3}]` matches actual
  `[todo_search {query: "latch"}, todo_done {id: 3}]`; expected `[todo_list {list: "garden"}]`
  against actual `[]` gives `expected 1 calls, got 0`; an expected call whose arguments fail
  `prepareArguments` (`todo_done` with `{ id: "three" }`) is compared as written.
- `test/model.test.ts`: for each of `"null"` and `"[1]"` as `function.arguments`, the call is
  recorded as `{ name: "todo_add", arguments: {} }`, the tool message is
  `Invalid arguments: expected a JSON object.`, and the backend state is unchanged.

### Exit criteria
- `matchCalls` takes the tools and compares both sides after `prepareArguments`
- A correct strict call matches an expected call written with aliases and alias values
- An extra read-only call that no expected call names is ignored; an expected read-only call is still required
- Non-object JSON arguments from the model produce `Invalid arguments: expected a JSON object.` and no tool call
- `llms.txt` documents the new `matchCalls` signature
- Only `src/eval/match.ts`, `src/eval/model.ts`, `src/bin/eval.ts`, `test/match.test.ts`, `test/model.test.ts`, `llms.txt` and `docs/decisions.md` are edited

### Gate
```
npm run typecheck && npm test && npm run build
```

---

## Phase 3: Model mode scores only what a model can do

Three problems in the eval command, all in its case loop:

- The error cases are deliberate mistakes for replay (`unknown-tool` calls a tool the model is
  never shown). A good model cannot reproduce them, so model mode can never pass every case
  and always exits 1.
- One model-endpoint failure (a 500, a 429, a body that is not JSON) is thrown out of the loop
  and ends the run with no summary.
- The default `--cases` path is built with `new URL(...).pathname`, which keeps `%20` for a
  space and gives `/C:/...` on Windows. Use `fileURLToPath` from `node:url`.

**1. A `replay_only` flag.** Add `replay_only?: boolean` to a case: in the TypeBox schema
`EvalCase` (`Type.Optional(Type.Boolean())`) and in the `EvalCase` type in
`src/eval/cases.ts`. In `eval/demo-cases.json`, set `"replay_only": true` on exactly these
five cases: `missing-argument`, `wrong-type`, `enum-miss`, `unknown-argument`,
`unknown-tool`. `unknown-id` stays scored: a good model does call `todo_done` with 99.

**2. Move the case loop into `src/eval/run.ts`,** so a test can run it without spawning the
bin:

```ts
/** Runs every case; model mode when `model` is given, replay otherwise. */
export async function runEval(file: CaseFileT, model?: ModelOptions): Promise<{ lines: string[]; ok: boolean }>
```

Per case, a fresh `createDemoBackend(file.today)` and `connect(backend)`, as the loop does
now. In model mode, a `replay_only` case is not run and gives the line `skip <id> (replay only)`.
Any error thrown while running one case gives `FAIL <id>: <error message>` and the loop goes on
to the next case. The other lines are unchanged (`ok   <id>`, `FAIL <id>: <mismatches joined by "; ">`).
The last line is the summary:

- replay mode: `<passed>/<total> cases`, for example `15/15 cases`
- model mode: `<passed>/<scored> cases, <skipped> replay-only skipped`, for example
  `9/10 cases, 5 replay-only skipped`

`ok` is true when every case that ran passed. `src/bin/eval.ts` keeps its option parsing,
calls `runEval`, prints each line with `console.log`, and exits 0 when `ok`, else 1.
`runEval` is not exported from `src/index.ts`.

**3. Docs.** In `README.md` under `## Eval`, add to the model-mode paragraph: model mode
compares each call after the validator's corrections, ignores extra read-only lookups, and
skips cases marked `replay_only`. In `llms.txt`, add the optional `replay_only` to the case
format at line 75 and to the `EvalCase` type at line 22, and give the model-mode summary line next to the
existing sentence at line 107.

**Where:**
- `src/bin/eval.ts` 1-50 — the whole command; the loop is 22-50
- `src/eval/cases.ts` 5-30 — the schema and the types
- `eval/demo-cases.json` — the five cases named above
- `src/eval/model.ts` 12-18 — `ModelOptions`
- `test/model.test.ts` 1-60 — `ScriptedFetch`, `toolCallMessage()`, `answerMessage()`; copy them
- `README.md` 149-156 and `llms.txt` 22, 75, 102-107 — the eval docs

Tests first, in a new `test/run.test.ts`:
- replay mode on `loadCases("eval/demo-cases.json")` gives no `FAIL` line and the last line
  `15/15 cases`, with `ok` true
- model mode, on an inline two-case file (one `replay_only` case and one case expecting
  `todo_list`), with a scripted fetch that answers with plain text: lines are
  `skip <id> (replay only)`, a `FAIL` line for the other case, and
  `0/1 cases, 1 replay-only skipped`; `ok` is false
- model mode on an inline two-case file whose fetch answers status 500 for the first request
  and then plain text: the first case gives `FAIL <id>: Model endpoint answered 500.`, the
  second case still runs, and the summary line is printed

### Exit criteria
- `replay_only` cases are skipped in model mode and run in replay mode
- Exactly the five named cases in `eval/demo-cases.json` carry `"replay_only": true`
- A thrown error in one case is that case's `FAIL` line, and later cases still run
- The summary line has the formats above, and the exit code follows `ok`
- The default `--cases` path is built with `fileURLToPath`
- `README.md` and `llms.txt` describe `replay_only` and how model mode compares calls, and `test/docs.test.ts` passes

### Gate
```
npm run typecheck && npm test && npm run build
```

---

## Phase 4: The demo never reuses an id, and reads today per call

Two bugs in the demo backend.

**1. Ids are never reused.** A new todo gets `max(existing id) + 1`, so after deleting #9 the
next add is #9 again, and a model holding the old #9 changes the wrong todo. Keep a counter per
backend instance, starting after the highest fixture id, and increment it on every add.

**2. Today is read per call.** `src/bin/demo.ts` passes today's date once, at start, so a
server left running past midnight resolves `today` and `tomorrow` against the start date.
Make the argument optional: `createDemoBackend(today?: string)`. Given, it is used as now (the
eval and the tests need a fixed date). Left out, every `todo_add` reads
`new Date().toLocaleDateString("sv-SE")` when it runs. `src/bin/demo.ts` calls
`createDemoBackend()`.

In a test, fake only the clock, so the MCP transport keeps working (checked against this
repository):

```ts
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 2, 2, 23, 0)); // local time; sv-SE gives 2026-03-02
// ... add a todo due "tomorrow" ...
vi.setSystemTime(new Date(2026, 2, 3, 1, 0));  // past midnight: 2026-03-03
// ... add another due "tomorrow" ...
vi.useRealTimers();
```

**Where:**
- `src/demo/backend.ts` 86-101 — `createDemoBackend` and the `todo_add` branch
- `src/bin/demo.ts` 5 — the one call with a live date
- `test/demo.test.ts` 1-27 — `connect()`, `text()`, `call()`; 150-164 — the delete test to copy

Tests first, in `test/demo.test.ts`:
- add `Milk` (gets #9), delete #9, add `Bread`: Bread's reply is `Added #10 'Bread' to home.`
- with no `today` argument and the clock set as above, the first `todo_add` with
  `due: "tomorrow"` replies `..., due 2026-03-03.` and the second `..., due 2026-03-04.`

### Exit criteria
- A deleted todo's id is never given to a new todo by the same backend
- `createDemoBackend()` with no argument resolves `today` and `tomorrow` against the clock at each call
- `createDemoBackend("2026-03-02")` behaves exactly as before, and every existing test passes unchanged
- Only `src/demo/backend.ts`, `src/bin/demo.ts`, `test/demo.test.ts` and `docs/decisions.md` are edited

### Gate
```
npm run typecheck && npm test && npm run build
```
