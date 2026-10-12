
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
