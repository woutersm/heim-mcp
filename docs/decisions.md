
## Phase 1: Tools and the validator

- `prepareArguments` treats a key as *present* only if it maps onto a declared property and its value is not `null`/`undefined` after aliasing; required is decided from typebox 1.x's per-property `~optional` marker (the `required` array is also emitted, but the marker is authoritative). "Missing argument" fires for required properties with no usable value.
- Error collection order follows the design: per-property sentences in property order, then unknown keys in the order sent, joined by a single space. Tests assert each sentence character for character.
- `assertFlat` and the validator share a `PropertySchema` cast because TypeBox's `TObject` `properties` type does not expose `~optional` or `enum` cleanly; the cast is contained to `validate.ts`.
