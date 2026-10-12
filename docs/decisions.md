
## Phase 1: Tools and the validator

- `prepareArguments` treats a key as *present* only if it maps onto a declared property and its value is not `null`/`undefined` after aliasing; required is decided from typebox 1.x's per-property `~optional` marker (the `required` array is also emitted, but the marker is authoritative). "Missing argument" fires for required properties with no usable value.
- Error collection order follows the design: per-property sentences in property order, then unknown keys in the order sent, joined by a single space. Tests assert each sentence character for character.
- `assertFlat` and the validator share a `PropertySchema` cast because TypeBox's `TObject` `properties` type does not expose `~optional` or `enum` cleanly; the cast is contained to `validate.ts`.

## Phase 2: The MCP server

- `createServer` reads `backend.tools()` once (not per request), so `tools/list` and `tools/call` share one tool table; duplicate-name and `assertFlat` checks are startup errors, not per-request.
- The internal-error handler logs `err.name` (falling back to `"Error"` for non-`Error` throws) and never the message, per the design's stdout rule.
- `serveStdio` exists only for the typecheck; nothing in the tests connects it, since `StdioServerTransport` would hold stdin.
