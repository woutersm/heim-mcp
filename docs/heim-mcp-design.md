# Design: heim-mcp, MCP tools that small models can drive

heim-mcp is a public TypeScript library: you describe each tool once with a TypeBox schema,
and it serves the tools over MCP (stdio). It is lenient with what a model sends, strict after
that, and answers every mistake with one English sentence. It ships a demo backend (an
in-memory household todo list) and a golden eval that replays cases through a real MCP
client. `README.md` is already written and is the product's promise: every name, sentence
and format below matches it. Do not edit `README.md`.

Decisions, for every phase:

| Topic | Decision |
| --- | --- |
| Runtime | Node 22 or later, ES modules (`"type": "module"`). Source files import each other with the `.ts` extension (`import { x } from "./tools.ts"`); the build rewrites them to `.js` |
| Dependencies | exactly these, installed once in phase 1 with `npm install --save-exact`: `@modelcontextprotocol/sdk@1.30.1`, `typebox@1.3.27`, `zod@4.6.5` (the SDK's peer; pinned so npm does not pick one); dev: `typescript@5.9.3`, `@types/node@22.20.4`, `vitest@5.0.2`. Add nothing else |
| Tests | vitest, in `test/`. No test touches the network, spawns a process, or starts a server. A client and a server are joined with the SDK's `InMemoryTransport` |
| stdout | over stdio, stdout is the protocol. No `console.log` anywhere in `src/`; logging is `console.error`, and a log line never holds an argument value or a reply, only a tool name and an error's `name` |
| Language | every text a model or person reads is English |
| Flat arguments | a tool's `parameters` is a `Type.Object` whose properties are string, integer, number, boolean, or a string enum. No nested object, no array |

The SDK's low-level server and client, as this design uses them (run against these versions):

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "demo", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "todo_add", description: "Add a todo.", inputSchema: jsonSchema, annotations: { readOnlyHint: false } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  // req.params.name: string; req.params.arguments: Record<string, unknown> | undefined
  return { content: [{ type: "text", text: "Added #9 'Milk' to shopping." }] };
  // a mistake the model should read: { content: [{ type: "text", text: "..." }], isError: true }
});
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "eval", version: "0.1.0" });
await client.connect(clientSide);
await client.listTools();   // { tools: [{ name, description, inputSchema, annotations }] }
await client.callTool({ name: "todo_add", arguments: { title: "Milk" } });
// → { content: [{ type: "text", text: "..." }], isError?: true }
await client.close();
// stdio: await server.connect(new StdioServerTransport());
```

Trap: a request handler that **throws** becomes a JSON-RPC error, so `client.callTool`
rejects and a model never sees the text. Every failure a model should read is returned as
`isError: true`, never thrown out of the handler.

TypeBox, as it behaves at 1.3.27:

```ts
import Type, { type TObject } from "typebox";
import Value from "typebox/value";
Type.Object({ id: Type.Integer({ minimum: 1 }), done: Type.Optional(Type.Boolean()) })
// → {"type":"object","required":["id"],"properties":{"id":{"type":"integer","minimum":1},"done":{"type":"boolean"}}}
Type.Enum(["home", "shopping"])          // → {"enum":["home","shopping"]}
Type.String({ description: "..." })      // → {"type":"string","description":"..."}
Value.Check(schema, value)               // → boolean
```

---

## Phase 1: Tools and the validator

Create the package and its core: the types a tool author writes, and the validator that turns
what a model sent into clean arguments or one English error.

- `package.json`: `"name": "heim-mcp"`, `"version": "0.1.0"`, `"description": "MCP tools that
  small and local models can drive: lenient in, strict after, errors a model can act on."`,
  `"license": "MIT"`, `"type": "module"`, `"engines": { "node": ">=22" }`, scripts
  `"typecheck": "tsc --noEmit"` and `"test": "vitest run"`. Then run, once:
  `npm install --save-exact @modelcontextprotocol/sdk@1.30.1 typebox@1.3.27 zod@4.6.5` and
  `npm install --save-exact --save-dev typescript@5.9.3 @types/node@22.20.4 vitest@5.0.2`.
  Commit `package-lock.json` with it.
- `tsconfig.json`, exactly:
  ```json
  {
    "include": ["src/**/*.ts", "test/**/*.ts"],
    "compilerOptions": {
      "target": "ES2023", "lib": ["ES2023"], "types": ["node"],
      "module": "NodeNext", "moduleResolution": "NodeNext",
      "allowImportingTsExtensions": true, "strict": true,
      "noUnusedLocals": true, "noUnusedParameters": true, "noFallthroughCasesInSwitch": true,
      "noEmit": true, "skipLibCheck": true
    }
  }
  ```
- `vitest.config.ts`: `defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } })`.
- `src/tools.ts`:
  ```ts
  import type { TObject } from "typebox";
  export interface ToolAnnotations { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }
  export interface ToolDef {
    name: string;
    description: string;
    parameters: TObject;
    annotations?: ToolAnnotations;
    /** Other names a model uses for an argument: alias → argument. */
    argAliases?: Record<string, string>;
    /** Other words for an enum value, per argument: argument → (alias → value). */
    valueAliases?: Record<string, Record<string, string>>;
  }
  export interface ToolBackend {
    tools(): readonly ToolDef[];
    /** `args` are already clean; returns the text the model reads. */
    call(name: string, args: Record<string, unknown>): string | Promise<string>;
  }
  /** A mistake the model can fix; its message is the sentence the model reads. */
  export class ToolError extends Error { /* name = "ToolError" */ }
  ```
- `src/validate.ts`:
  - `assertFlat(tool: ToolDef): void` throws a plain `Error` (`Tool 'x': argument 'y' is not
    flat.`) when a property is not string, integer, number, boolean, or a string enum (an
    `enum` array, or an `anyOf` of `const` strings).
  - `prepareArguments(tool: ToolDef, raw: unknown): Record<string, unknown>`, in this order:
    1. `undefined` → `{}`. A string is `JSON.parse`d; failure → `Invalid arguments: not valid JSON.`
    2. Not a plain object (null, array, number) → `Invalid arguments: expected a JSON object.`
    3. Keys: an `argAliases` key is renamed to its argument; then a key equal to a property
       name ignoring case is renamed to that name. If the real name is also present, it wins
       and the alias is dropped.
    4. A key whose value is `null` is dropped.
    5. Per property, in the order of `parameters.properties`: integer: a string matching
       `^-?\d+$` becomes a number; number: a string that `Number()` reads as finite becomes
       a number; boolean: `"true"`/`"false"` in any case become booleans; string: a number
       becomes `String(n)`; enum: trim, then `valueAliases[arg]` looked up ignoring case,
       then the allowed value equal ignoring case → the canonical value.
    6. Errors, one sentence each, collected in property order, then unknown keys:
       - `Missing argument 'title'.`
       - `Argument 'id' must be an integer.` / `must be a number.` / `must be true or false.` / `must be text.`
       - `Argument 'list' must be one of: home, shopping, garden.`
       - `Argument 'id' must be at least 1.` / `must be at most 10.` (from `minimum`/`maximum`)
       - `Unknown argument 'colour'. todo_add takes: title, list, due.` (property order)
       If any, throw one `ToolError` with the sentences joined by a single space.
    7. Safety net: if `Value.Check(tool.parameters, result)` is still false, throw
       `ToolError("Invalid arguments for 'todo_add'.")`. Return the result.
- `src/index.ts`: re-exports `ToolDef`, `ToolAnnotations`, `ToolBackend`, `ToolError`,
  `prepareArguments`, `assertFlat`.

**Where:** a new, empty repository except `README.md`, `.gitignore` and `docs/`. Everything is
created here.

Tests first, in `test/validate.test.ts`, with a `todo_add`-like tool
(`title` string, `list` optional enum `home|shopping|garden`, `due` optional string) and a `todo_done`-like tool (`id` integer, minimum 1), one test each for: a JSON-string
argument, invalid JSON, a non-object, an `argAliases` rename, a case-different key, the real
name winning over its alias, `null` dropped, `"3"` → `3`, `"TRUE"` → `true`, `42` → `"42"`, an
enum by case and by `valueAliases`, each sentence in step 6 exactly, two errors joined in
property order, and `assertFlat` refusing an array and a nested object.

### Exit criteria
- `prepareArguments` gives each sentence in step 6 character for character, and the tests assert them that way
- A tool with an array or a nested-object property is refused by `assertFlat`
- `package.json` lists exactly the six dependencies above at those exact versions, and `package-lock.json` is committed
- No `console.log` in `src/`

### Gate
```
npm ci && npm run typecheck && npm test
```

---

## Phase 2: The MCP server

Serve a `ToolBackend` over MCP.

- `src/server.ts`: `createServer(backend: ToolBackend, info: { name: string; version: string }): Server`.
  - Reads `backend.tools()` once. Calls `assertFlat` on each tool; a duplicate name throws
    `Error("Duplicate tool 'x'.")`.
  - `tools/list`: one entry per tool, in the backend's order: `name`, `description`,
    `inputSchema: JSON.parse(JSON.stringify(tool.parameters))`, and `annotations` only when
    the tool has them.
  - `tools/call`:
    - unknown name → `isError: true`, `Unknown tool 'todo_finish'. Tools: todo_add, todo_list.` (backend order)
    - `prepareArguments(tool, req.params.arguments)`; a `ToolError` → `isError: true` with its message
    - `await backend.call(name, args)` → `{ content: [{ type: "text", text }] }`
    - a `ToolError` thrown by `call` → `isError: true` with its message
    - any other error → `isError: true`, `The tool 'todo_add' failed with an internal error.`,
      and `console.error("[heim-mcp] todo_add failed: " + err.name)` — never the message
    - nothing is thrown out of the handler (see the trap in the preamble)
- `src/stdio.ts`: `serveStdio(backend, info): Promise<void>`, `createServer` then
  `server.connect(new StdioServerTransport())`. No test runs it (it would hold stdin);
  the typecheck covers it.
- `src/index.ts`: also export `createServer` and `serveStdio`.

**Where:**
- `src/validate.ts` (phase 1): `prepareArguments`, `assertFlat`
- `src/tools.ts` (phase 1): `ToolBackend`, `ToolError`
- `test/validate.test.ts` (phase 1): copy its tool definitions for the fake backend

Tests first, in `test/server.test.ts`, with a fake backend joined by `InMemoryTransport`:
`listTools` returns the tools in order with their JSON schema and annotations, and none on a
tool without; a good call returns the backend's text; an unknown tool, a validation error, a
`ToolError` from `call`, and a plain `Error` from `call` each come back as `isError: true`
with their sentence (the last one also calls `console.error` once, checked with
`vi.spyOn(console, "error")`, and the logged line does not contain the error's message);
`callTool` never rejects in these cases; `createServer` throws on a duplicate name and on a
non-flat tool.

### Exit criteria
- Every failure in `tools/call` reaches the client as `isError: true` with the sentence above; no test sees `callTool` reject
- The internal-error log line holds the tool name and the error's `name` only
- `serveStdio` exists and typechecks; no test spawns a process or uses stdio
- Nothing outside `src/server.ts`, `src/stdio.ts`, `src/index.ts` and `test/server.test.ts` is edited

### Gate
```
npm ci && npm run typecheck && npm test
```

---

## Phase 3: The demo backend

An in-memory household todo list with invented data, runnable as `heim-mcp-demo`, and the build
that makes it runnable from npm.

- `src/demo/fixtures.ts`: `FIXTURES`, eight todos with ids 1 to 8, invented, no person's name:
  ```
  1 Buy dish soap        shopping  due 2026-03-02  open
  2 Oat milk             shopping  no due          open
  3 Fix the gate latch   garden    due 2026-03-04  open
  4 Prune the apple tree garden    no due          open
  5 Descale the kettle   home      due 2026-03-01  open
  6 Replace hallway bulb home      no due          done
  7 Book chimney sweep   home      due 2026-03-10  open
  8 Coffee beans         shopping  no due          done
  ```
  Type: `{ id: number; title: string; list: "home" | "shopping" | "garden"; due: string | null; done: boolean }`.
- `src/demo/backend.ts`: `createDemoBackend(today: string): ToolBackend` (`today` is
  `YYYY-MM-DD`). Each backend starts from a fresh copy of `FIXTURES`; a new id is the highest
  id + 1. Five tools, in this order:

  | Tool | Parameters | Annotations | Aliases |
  | --- | --- | --- | --- |
  | `todo_add` | `title` string; `list` optional enum `home, shopping, garden` (default `home`); `due` optional string | `readOnlyHint: false, destructiveHint: false` | args `text`, `name` → `title`; `date`, `when` → `due`; `category` → `list`. Values for `list`: `groceries`, `boodschappen` → `shopping`; `house`, `thuis` → `home`; `tuin` → `garden` |
  | `todo_list` | `list` optional enum; `done` optional boolean (default false) | `readOnlyHint: true` | values for `list` as above |
  | `todo_done` | `id` integer, minimum 1 | `readOnlyHint: false, destructiveHint: false, idempotentHint: true` | args `todo_id`, `todo` → `id` |
  | `todo_delete` | `id` integer, minimum 1 | `readOnlyHint: false, destructiveHint: true` | args `todo_id`, `todo` → `id` |
  | `todo_search` | `query` string | `readOnlyHint: true` | args `q`, `text` → `query` |

  Every property has a one-line English `description`. `due` takes `YYYY-MM-DD` (a real date),
  `today` or `tomorrow` (ignoring case); anything else is
  `ToolError("Argument 'due' must be a date as YYYY-MM-DD, 'today' or 'tomorrow'.")`.
  Tomorrow: `new Date(today + "T00:00:00Z")` plus one UTC day, `.toISOString().slice(0, 10)`.

  Replies, exactly:
  - a todo line: `#3 Fix the gate latch (garden, due 2026-03-04)`, or `#2 Oat milk (shopping)`
    without a due date; a done todo ends with ` [done]`
  - `todo_add`: `Added #9 'Milk' to shopping, due 2026-03-03.` or `Added #9 'Milk' to shopping.`
  - `todo_list`: the matching todo lines in id order, joined by `\n`; none → `Nothing on the list.`
  - `todo_done`: `Done: #3 'Fix the gate latch'.`; already done → `#6 'Replace hallway bulb' was already done.`
  - `todo_delete`: `Deleted #3 'Fix the gate latch'.`
  - `todo_search`: todo lines (open and done) whose title contains `query` ignoring case, in
    id order; none → `Nothing matches 'xyz'.`
  - an id that does not exist (done, delete): `ToolError("No todo #42. Use todo_list to see the ids.")`
- `src/bin/demo.ts`: first line `#!/usr/bin/env node`; serves `createDemoBackend(<local date
  today as YYYY-MM-DD>)` with `serveStdio` under `{ name: "heim-mcp-demo", version: "0.1.0" }`.
  Local date: `new Date().toLocaleDateString("sv-SE")`.
- `tsconfig.build.json`, exactly:
  ```json
  {
    "include": ["src/**/*.ts"],
    "compilerOptions": {
      "target": "ES2023", "lib": ["ES2023"], "types": ["node"],
      "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "skipLibCheck": true,
      "rewriteRelativeImportExtensions": true, "outDir": "dist", "declaration": true
    }
  }
  ```
  (checked: `import { x } from "./a.ts"` is emitted as `"./a.js"`, and the shebang is kept).
- `package.json`: script `"build": "tsc -p tsconfig.build.json"`, `"bin": { "heim-mcp-demo":
  "dist/bin/demo.js" }`, `"exports": { ".": { "types": "./dist/index.d.ts", "default":
  "./dist/index.js" } }`, `"files": ["dist"]`.
- `src/index.ts`: also export `createDemoBackend`.

**Where:**
- `src/tools.ts` (phase 1): `ToolDef`, `ToolBackend`, `ToolError`
- `src/server.ts` (phase 2), `test/server.test.ts`: how a test joins a client to a server; copy it

Tests first, in `test/demo.test.ts`, through `createServer` and a `Client` (not by calling the
backend directly), with `today` = `2026-03-02`: each reply format above on the fixtures; add
with `tomorrow` and with an invalid due; `list: "Groceries"` and `"tuin"`; `text` for `title`;
`id: "3"`; done twice; delete then list; an unknown id; search hitting a done todo; and that
`listTools` shows `destructiveHint: true` on `todo_delete` only.

### Exit criteria
- The fixtures are exactly the eight rows above
- Every reply format above is asserted character for character in `test/demo.test.ts`, through an MCP client
- `npm run build` writes `dist/bin/demo.js` starting with `#!/usr/bin/env node`, with `.js` imports
- No test starts the demo bin

### Gate
```
npm ci && npm run typecheck && npm test && npm run build
```

---

## Phase 4: Golden replay eval

Cases in a JSON file, replayed through a real MCP client against a fresh demo backend, each
reply compared to its golden text.

- `eval/demo-cases.json`, the format:
  ```json
  {
    "today": "2026-03-02",
    "cases": [
      {
        "id": "add-with-alias-and-day-word",
        "message": "Put milk on the groceries, for tomorrow",
        "calls": [
          {
            "name": "todo_add",
            "arguments": { "text": "Milk", "list": "Groceries", "due": "tomorrow" },
            "reply": "Added #9 'Milk' to shopping, due 2026-03-03."
          }
        ]
      }
    ]
  }
  ```
  A call may carry `"error": true` when its reply is an `isError` result. Include the case
  above verbatim (`README.md` shows it), and at least 13 more, so that between them they cover:
  every tool; a two-call case (list then done); arguments as a small model sends them (`"id": "3"`,
  `null` for an optional, `"Groceries"`, `todo_id`); and as `"error": true` calls: a missing
  argument, a wrong type, an enum miss, an unknown argument, an unknown tool, an unknown id.
  Each `reply` is written from the reply formats of phase 3, not copied from a run.
- `src/eval/cases.ts`: the types (`EvalCall { name; arguments; reply; error? }`, `EvalCase { id;
  message; calls }`, `CaseFile { today; cases }`) as a TypeBox schema, and
  `loadCases(path: string): CaseFile` (`readFileSync`, `JSON.parse`, `Value.Check`; a bad file
  throws `Error("<path>: not a case file.")`; duplicate ids throw `Error("<path>: duplicate case id 'x'.")`).
- `src/eval/connect.ts`: `connect(backend: ToolBackend): Promise<Client>`, the in-memory pair
  from the preamble, server from `createServer(backend, { name: "heim-mcp-eval", version: "0.1.0" })`.
- `src/eval/replay.ts`: `replayCase(backend: ToolBackend, c: EvalCase): Promise<string[]>`:
  connects, runs each call with `client.callTool`, closes, and returns the mismatches (empty
  = pass), each one line:
  `call 1: expected "Added #9 'Milk' to shopping.", got "Added #9 'Milk' to home."` or
  `call 2: expected an error, got a result` / `call 2: expected a result, got an error`.
- `src/index.ts`: also export `loadCases`, `replayCase`, `connect`.

**Where:**
- `src/demo/backend.ts` (phase 3): `createDemoBackend(today)`, the reply formats
- `test/demo.test.ts` (phase 3): how a test reaches the demo through a client

Tests first, in `test/replay.test.ts`: every case in `eval/demo-cases.json` replays with no
mismatch, each against `createDemoBackend(file.today)` (one `it` per case, named by its id);
a case with a wrong golden reply gives exactly the mismatch line above; `"error": true` on a
call that succeeds gives `expected an error, got a result`; `loadCases` refuses a file with a
missing `reply` and one with a duplicate id (write those two to `os.tmpdir()`).

### Exit criteria
- `eval/demo-cases.json` holds the README's case verbatim and at least 13 more covering the list above
- Every case replays clean through `connect` and `client.callTool`
- A wrong golden reply is reported as the exact mismatch line
- Nothing in `src/demo/` is edited

### Gate
```
npm ci && npm run typecheck && npm test && npm run build
```

---

## Phase 5: Model mode and the eval command

Run the same cases against a real model through any OpenAI-compatible `/chat/completions`
endpoint, and the `heim-mcp-eval` command for both modes.

The endpoint, as this phase uses it. Request (`POST {baseUrl}/chat/completions`, header
`content-type: application/json`, plus `authorization: Bearer <key>` when a key is set):
```json
{
  "model": "qwen3-30b-a3b",
  "temperature": 0,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Put milk on the groceries, for tomorrow" }
  ],
  "tools": [
    { "type": "function", "function": { "name": "todo_add", "description": "...", "parameters": { "type": "object", "properties": {} } } }
  ]
}
```
Response, a tool call (note: `content` is often **absent**, not `null` or `""`):
```json
{ "choices": [ { "message": { "role": "assistant", "tool_calls": [
  { "id": "call_1", "type": "function", "function": { "name": "todo_add", "arguments": "{\"text\":\"Milk\"}" } }
] } } ] }
```
`arguments` is a JSON **string**. A final answer is `{ "choices": [ { "message": { "role":
"assistant", "content": "Added." } } ] }`. A tool result goes back as
`{ "role": "tool", "tool_call_id": "call_1", "content": "<reply text>" }`, after the assistant
message that made the call (sent back as it came).

- `src/eval/model.ts`: `runModelCase(client: Client, c: EvalCase, today: string, opts: {
  baseUrl: string; model: string; apiKey?: string; fetch: typeof fetch; maxSteps?: number }):
  Promise<{ calls: { name: string; arguments: Record<string, unknown> }[]; answer: string }>`.
  - Tools from `client.listTools()`, mapped to the `tools` array above (`parameters` = `inputSchema`).
  - System message, exactly: `You manage a household todo list through tools. Today is
    2026-03-02. Use the tools, then answer in one short sentence.` (with `today`).
  - Loop, at most `maxSteps` (default 6) requests: a message with `tool_calls` → for each
    call, `JSON.parse` its `arguments`; on failure record `{}` and send back
    `Invalid arguments: not valid JSON.` without calling; otherwise record it, call
    `client.callTool`, and send back its text. A message without `tool_calls` ends the loop;
    `answer` is its `content ?? ""`.
  - A non-2xx response throws `Error("Model endpoint answered <status>.")`.
- `src/eval/match.ts`: `matchCalls(expected: EvalCall[], actual: { name; arguments }[]): string[]`:
  mismatches, one line each: a count difference (`expected 2 calls, got 1`), and per position
  a name difference (`call 1: expected todo_add, got todo_list`) or an expected argument
  missing or different (`call 1: argument 'list' expected "shopping", got "home"`). Values are
  equal when both, as strings, trimmed and lower-cased, are equal; extra actual arguments are fine.
- `src/bin/eval.ts`: `#!/usr/bin/env node`; `node:util` `parseArgs` with `--replay`,
  `--base-url` (default `http://localhost:8080/v1`), `--model` (default `local`), `--cases`
  (default the package's own `eval/demo-cases.json`: `new URL("../../eval/demo-cases.json",
  import.meta.url)`); key from `process.env.OPENAI_API_KEY`. Per case one line to stdout:
  `ok   <id>` or `FAIL <id>: <mismatches joined by "; ">`, then `<passed>/<total> cases`. Exit
  code 0 when all pass, else 1. `--replay` uses `replayCase`; otherwise a fresh
  `createDemoBackend(file.today)` and `connect` per case, `runModelCase` with the global
  `fetch`, then `matchCalls`. (stdout is fine here: this bin is not an MCP server.)
- `package.json`: `bin` gains `"heim-mcp-eval": "dist/bin/eval.js"`; `files` becomes `["dist", "eval"]`.
- `src/index.ts`: also export `runModelCase`, `matchCalls`.

**Where:**
- `src/eval/cases.ts`, `src/eval/connect.ts`, `src/eval/replay.ts` (phase 4)
- `test/replay.test.ts` (phase 4): copy its setup

Tests first, in `test/model.test.ts`, with a scripted `fetch` (a list of responses, recording
each request body; no network): a two-step run records the call, sends the tool reply back as
a `role: "tool"` message with the right `tool_call_id`, and returns the final `content`; a
tool-call message with no `content` key works; invalid JSON arguments send back the sentence
and call nothing (the demo's state is unchanged, checked with `todo_list`); `maxSteps` stops
a model that never stops calling; a 500 throws the sentence; the request carries the system
message with `today` and the five tools; the `authorization` header is present only with a
key. In `test/match.test.ts`: each mismatch line above, and `"Shopping"` matching `"shopping"`.

### Exit criteria
- `runModelCase` handles a tool-call message with no `content` key
- Invalid JSON arguments never reach `client.callTool`
- Every mismatch line in `matchCalls` is asserted exactly
- No test calls the real `fetch` or runs the bin

### Gate
```
npm ci && npm run typecheck && npm test && npm run build
```

---

## Phase 6: Docs for machines, and the README kept honest

`README.md` exists and is not edited. This phase writes what an agent reads, the license, and
a test that keeps the README true to the code.

- `llms.txt` (the llmstxt.org shape: `# heim-mcp`, a `>` one-line summary, then sections).
  For an agent that uses or extends the library: `## API` (each export of `src/index.ts`
  with its signature and one line), `## Rules` (lenient in / strict after with the exact
  normalisations of phase 1 step 3-5; flat arguments; errors as `isError` results; stdout;
  annotations), `## Error sentences` (every sentence of phases 1, 2 and 3 as a template),
  `## Demo tools` (the five, with parameters and aliases), `## Eval` (the case format and
  both commands).
- `AGENTS.md`: styre wrote a block at the top of this file; leave it untouched and append, at
  the end, a `# heim-mcp` section for an agent working in this repository: the checks
  (`npm run typecheck && npm test && npm run build`), and the rules — no network, process or
  server in a test; no `console.log` in `src/` outside `src/bin/eval.ts`; flat arguments;
  every failure a model should read is an `isError` result, never thrown from a handler;
  a dependency only at an exact version the owner names; `README.md` changes only with its test.
- `LICENSE`: the MIT license text, `Copyright (c) 2026 Martijn Wouters`.
- `test/docs.test.ts`:
  - every demo tool name appears in `README.md` and in `llms.txt`;
  - each line of the README's error block (the fenced block under `## Error sentences`)
    is produced exactly by the code: `Missing argument 'title'.`, `Argument 'id' must be an
    integer.`, `Argument 'list' must be one of: home, shopping, garden.` and `Unknown argument
    'colour'. todo_add takes: title, list, due.` from `prepareArguments` on the demo's tools,
    and the `Unknown tool 'todo_finish'. Tools: ...` line from a `callTool` on the demo
    server;
  - the README's eval example case is in `eval/demo-cases.json` with the same arguments and reply;
  - `package.json`'s `bin` names (`heim-mcp-demo`, `heim-mcp-eval`) appear in `README.md`.

**Where:**
- `README.md`: the error block is under `## Error sentences`;
  the eval example under `## Eval`
- `src/index.ts`: the exports to document
- `src/validate.ts`, `src/server.ts`, `src/demo/backend.ts`: the sentences

### Exit criteria
- `README.md` is unchanged
- `test/docs.test.ts` checks each README claim listed above against the code
- `llms.txt` lists every export of `src/index.ts` and every error sentence
- The styre block at the top of `AGENTS.md` is unchanged; the new section is appended after it
- No file in `src/` is edited

### Gate
```
npm ci && npm run typecheck && npm test && npm run build
```
