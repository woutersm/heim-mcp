
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
