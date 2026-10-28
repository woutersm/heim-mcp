
## Phase 1: Tools and the validator

- `prepareArguments` treats a key as *present* only if it maps onto a declared property and its value is not `null`/`undefined` after aliasing; required is decided from typebox 1.x's per-property `~optional` marker (the `required` array is also emitted, but the marker is authoritative). "Missing argument" fires for required properties with no usable value.
- Error collection order follows the design: per-property sentences in property order, then unknown keys in the order sent, joined by a single space. Tests assert each sentence character for character.
- `assertFlat` and the validator share a `PropertySchema` cast because TypeBox's `TObject` `properties` type does not expose `~optional` or `enum` cleanly; the cast is contained to `validate.ts`.

## Phase 2: The MCP server

- `createServer` reads `backend.tools()` once (not per request), so `tools/list` and `tools/call` share one tool table; duplicate-name and `assertFlat` checks are startup errors, not per-request.
- The internal-error handler logs `err.name` (falling back to `"Error"` for non-`Error` throws) and never the message, per the design's stdout rule.
- `serveStdio` exists only for the typecheck; nothing in the tests connects it, since `StdioServerTransport` would hold stdin.

## Phase 3: The demo backend

- Invented the eight fixture todos exactly as specified; `createDemoBackend` deep-copies them per backend instance, so each backend is independent and a new id is max id + 1.
- `due` is validated in the backend, not the TypeBox schema: the schema is a plain `Type.String()` and the backend accepts `YYYY-MM-DD` (rejecting impossible dates like 2026-02-30 via a round-trip check), `today`, or `tomorrow` case-insensitively. Kept the schema a plain string so the JSON schema stays simple for small models.
- `tomorrow` is computed from the injected `today` in UTC; the bin injects the local date via `new Date().toLocaleDateString("sv-SE")` which is `YYYY-MM-DD`.
- The demo tool list is a module-level constant; only the todo data is per-backend mutable state.

## Phase 4: Golden replay eval

- The `CaseFile` TypeBox schema uses `Type.Object({})` for `arguments` and `Type.Optional(Type.Boolean())` for `error`; at typebox 1.3.27 the former accepts any JSON object (including nested) and the latter accepts `true` and `false` but not a missing key. The runtime types (`CaseFileT` etc.) are declared by hand rather than `Value.Infer`, because the two diverge for `arguments` and `error` (infer gives `object` and makes `error` required).
- `eval/demo-cases.json` holds 15 cases: the README's case verbatim plus 14 covering every tool, a two-call case, small-model argument shapes (`"id": "3"`, `null`, `"Groceries"`, `todo_id`) and five `error: true` cases (missing arg, wrong type, enum miss, unknown arg, unknown tool, unknown id). Goldens are written from phase 3's reply formats, not copied from a run.
- `connect()` closes the server when the client is closed by wrapping `client.close()` with the bound original plus `server.close()`, so callers only handle one handle.

## Phase 5: Model mode and the eval command

- `runModelCase` pushes the assistant message back verbatim (including when `content` is absent) and then one `role: "tool"` message per call. An unparseable `arguments` JSON records `{}` in the result `calls` but never reaches `client.callTool`; the model gets the fixed sentence `Invalid arguments: not valid JSON.`
- `matchCalls` compares argument values with both sides trimmed and lower-cased as strings; missing expected arguments report `got <absent>`, extra actual arguments are ignored. Count differences get exactly one line (`expected 2 calls, got 1`), after which per-position lines still run.
- `heim-mcp-eval` defaults `--cases` to the package's own `eval/demo-cases.json` via `new URL("../../eval/demo-cases.json", import.meta.url).pathname`; `files` now ships `eval/` alongside `dist/`. The API key comes only from `OPENAI_API_KEY`; a key of `""` still sets the authorization header (checked for `undefined`, not truthiness).
- The bin creates one fresh backend and connects one client per case (model mode needs the client for `listTools`; replay mode reuses `replayCase` which wants the backend).

## Phase 6: Docs for machines, and the README kept honest

- `test/docs.test.ts` derives its expectations from the code rather than re-typing them: it reads the README's fenced `## Error sentences` block (pinned to exactly 5 lines), extracts each line, and asserts each both against the literal sentence and against the real output of `prepareArguments`/`callTool` on the demo tools — so a README edit that drifts from the code fails the same test that edits it. The eval example is matched by case id and compared argument-by-argument to `eval/demo-cases.json`.
- The `llms.txt` API section is checked by parsing `src/index.ts` export names with a regex, not by a hand-kept list; a new export without docs fails the test.
- `AGENTS.md` keeps its rules short and rule-level (why: a model reads and acts on this file); the detailed how-tos live in `llms.txt` and the code.

## Phase 1: The server and the validator keep the README's promise

- The `tools/call` handler is registered through `Protocol.prototype.setRequestHandler` with a lenient hand-rolled schema (`arguments: z.unknown().optional()`) instead of the SDK's `CallToolRequestSchema`. The SDK's `Server.setRequestHandler` wraps every `tools/call` handler with a strict check that rejects a string, `null` or array `arguments` with a JSON-RPC error before `prepareArguments` ever runs, so the README's promise (a JSON string is parsed; a non-object gets the `Invalid arguments: expected a JSON object.` sentence) was unreachable over MCP.
- In `prepareArguments`, `null` values are dropped *before* alias renaming, and alias keys are renamed in a first pass with every other key in a second pass: the real name then overwrites its alias in either key order, a `null` alias can never remove a real value, and unknown keys keep their sent order in the `Unknown argument` sentence.
- `propertyType` checks `enumValues(prop) !== null` before looking at `type`, so a `{ type: "string", enum: [...] }` property (e.g. written via `Type.Unsafe`) gets value aliases, case-insensitive matching and the `must be one of` sentence, not plain-string handling.

## Phase 2: matchCalls compares what the model meant

`matchCalls` now takes the backend's tools as a required third argument and runs both the
expected and the actual call's arguments through `prepareArguments` for the tool of that name
before comparing. This makes a correct, strict call (real names, canonical enum values) match
an expected call written with aliases and alias values. When there is no tool of the name, or
`prepareArguments` throws (e.g. an expected `id: "three"` for an integer), that side is
compared as written — the raw values, same mismatch lines as before.

Extra actual calls of a read-only tool (`annotations.readOnlyHint === true`) whose name appears
in no expected call are dropped before the count comparison, since a model that looks
something up first (e.g. `todo_search` before `todo_done`) is sensible. A read-only call the
case actually expects is kept and still required, so `list-open-garden` fails with zero calls.

In `runModelCase`, `function.arguments` that parses to a non-object (`"null"`, `"[]"`, `"5"`)
is treated like unparseable JSON: the model gets `Invalid arguments: expected a JSON object.`,
the call is recorded with `{}` arguments, and the tool is not called.

Decision on the non-object JSON wording: this reuses the exact `Invalid arguments: expected a
JSON object.` sentence `prepareArguments` already produces, so the model always reads the same
sentence whether the invalidity was caught in the model loop or the validator.

## Phase 3: Model mode scores only what a model can do

- The case loop moved from `src/bin/eval.ts` into `src/eval/run.ts` (`runEval(file, model?)`)
  so tests exercise it without spawning the bin. `runEval` is deliberately not exported from
  `src/index.ts` — it is eval plumbing, not library surface. `runOne` catches per-case throws
  (endpoint 500/429, non-JSON bodies) into a `FAIL <id>: <message>` line; one endpoint
  failure can no longer kill the run before the summary.
- `replay_only?: boolean` on `EvalCase` (TypeBox `Type.Optional(Type.Boolean())`). Model mode
  skips it (`skip <id> (replay only)`, excluded from the scored count and from `ok`); replay
  mode ignores the flag entirely and runs every case. Exactly five shipped cases carry it —
  the deliberate mistakes a good model cannot reproduce; `unknown-id` stays scored.
- Summary line formats: replay `<passed>/<total> cases`; model `<passed>/<scored> cases,
  <skipped> replay-only skipped`. The bin prints the lines and exits on `ok`.
- Default `--cases` path is now `fileURLToPath(new URL(...))` — no `%20`, and a correct
  absolute path on Windows.

## Phase 4: The demo never reuses an id, and reads today per call

- New ids come from a per-backend counter (`idCounter`) initialized to the highest fixture
  id and incremented only on `todo_add`; `max(existing) + 1` is gone, so a deleted id is
  never handed out again. Deletion still removes the todo from the list, it just no longer
  reopens the id.
- `createDemoBackend(today?: string)`: a given date is captured at construction (eval and
  tests need a fixed date); with no argument, `todo_add` reads
  `new Date().toLocaleDateString("sv-SE")` at the moment each call runs, so a server left
  running past midnight resolves `today`/`tomorrow` correctly. `src/bin/demo.ts` now calls
  `createDemoBackend()`.
- The clock test in `test/demo.test.ts` fakes only `Date` (`vi.useFakeTimers({ toFake:
  ["Date"] })`) and connects inside the fake window — the InMemoryTransport keeps working
  because timers it might use are untouched.
- Kept inside the four files the phase allows: `llms.txt` still says `createDemoBackend(today:
  string)`; the optional parameter drifts one word from that doc line. The phase's file
  list wins over the docs-consistency habit, and `test/docs.test.ts` does not check that
  line, so the gate is unaffected.

## Plain mode and what model mode scores (2026-10-26)

- `--plain` exists to measure heim-mcp against the baseline a reader would otherwise use: an
  MCP SDK server with a zod schema. It mimics that server — unknown keys dropped, everything
  else checked as sent, the SDK's `Input validation error: Invalid arguments for tool …` text —
  and returns the miss as an `isError` result, the more forgiving of the SDK's two behaviours,
  so the baseline is not handicapped.
- Model mode now drops calls the server turned away at the argument check, in both modes.
  Before, the matcher ran every call through `prepareArguments`, so a plain-mode call with
  `list: "Groceries"` would have matched even though the server rejected it, and the two
  modes would have scored the same. A model that reads an error and retries correctly passes;
  that recovery is what the error sentences are for.
- A tool call whose arguments were not JSON is recorded with `{}`; if that happens to satisfy
  the check (a tool with no required arguments) it counts as a call that ran. No demo case
  expects a no-argument call, so it can only turn a pass into a fail, never the reverse.
- Eight model-mode cases were added (2026-10-26) so a heim-vs-plain score rests on 17 cases,
  not 9. They aim at what the corrections cover and a plain server rejects: Dutch and English
  list aliases (`boodschappen`, `tuin`, `thuis`, `house`) and a capitalised enum value, plus
  two where the model has to look an id up first. Titles are Dutch words with no common
  English form (`hagelslag`) so a model translating the title does not fail for that reason.

## Unknown arguments are dropped, not rejected (2026-10-27)

- Evidence is in `docs/eval-findings.md`. Over 342 model calls from Qwen3.5 0.8B–9B the old
  corrections never fired; what changed outcomes was unknown arguments. A plain server drops
  them silently; heim-mcp rejected them, and small models handled the rejection worse: the
  0.8B's retry went wrong, and the 2B answered "I've added the task" without retrying.
- So an unknown argument no longer fails a call on its own. The call runs and the reply gets
  one more line, `Ignored unknown argument 'x'. <tool> takes: ….` That keeps what was useful
  about the error (the model learns the real names) without stopping the action. When the call
  fails for another reason, the unknown names stay in the error, since the model is retrying
  anyway. `prepareCall` returns the dropped names; `prepareArguments` keeps its signature.
- Optional arguments sent as `""` or blank are read as absent, like `null`; the 2B sent
  `"list": "", "due": ""` and never recovered from the enum error. A required argument keeps
  its empty string, so an empty title is still the backend's business.
- Argument names are trimmed before matching; the 2B sent `"list\n"`.
- Rejected alternative: map a key that equals an enum value (`"shopping": "True"`) onto that
  enum. Seen once, from the 0.8B, and too clever to be predictable.

## Model mode scores the arguments that ran

Model mode used to score the arguments the model sent, run through heim-mcp's own preparation.
In `--plain` mode that hid what the plain server did: the 2B sent `"list\n": "garden"`, the
plain check dropped the key and listed everything, and the case still passed because the
scorer trimmed the key. A call is now scored with the arguments its server ran it with, so
each mode is judged on its own result. Unscored cases still show what the model sent, since
that is what they are there to show.

## Day words match their dates, and scoring happens at the backend

A case that expects `"due": "tomorrow"` now also passes on the date itself (`2026-03-03` when
the case file's today is 2026-03-02). The demo accepts both, so a model that works out the date
did nothing wrong; the exploration script already counted them as equal, and the first
`heim-mcp-eval` rerun did not, which made the 2B look two cases worse without descriptions.

Model mode now scores the calls that reach the todo tools, logged at the backend, instead of
the model's calls run through the argument check again. The two agree, except when a tool
resolves its own input: with `--title-lookup`, `todo_done {"title": "kettle"}` reaches the
backend as `todo_done {"id": 5}`, and that is what the case's expected call names. The
lookup's own `todo_search` is read-only and ignored like any extra read-only call.

## Tool-design options are eval options, not demo changes

`--title-hint`, `--id-hint` and `--title-lookup` change the tools only inside the eval. The demo
stays as the README documents it, so each pattern can be measured against the same baseline;
whichever earns its place can move into the demo later, with its README and test.
