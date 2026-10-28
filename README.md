# heim-mcp

[![CI](https://github.com/woutersm/heim-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/woutersm/heim-mcp/actions/workflows/ci.yml)

heim-mcp is a TypeScript library that serves tools over MCP (stdio) to small and local
models. You define each tool once with a [TypeBox](https://github.com/sinclairzx81/typebox)
schema. heim-mcp corrects the argument mistakes small models make, checks the result against
the schema, and returns each error as one English sentence the model can act on. It ships
with a demo server and an eval that replays golden cases through a real MCP client.

Status: in development. This README describes version 0.1.0, which is not on npm yet: run it
from a clone.

## Capabilities

- Serves any `ToolBackend` over MCP, with `createServer` for any transport or `serveStdio`.
- Normalises arguments before the schema check: JSON-string arguments, `null` and empty
  optional values, argument aliases and padded names, numbers and booleans sent as strings,
  enum values in any case.
- Drops unknown arguments and runs the call, then says after the reply what it ignored.
- Returns every failure as an MCP result with `isError: true` and one sentence, so the model
  reads it and retries.
- Rejects tools with nested objects or arrays in their arguments at startup.
- Publishes `readOnlyHint`, `destructiveHint` and `idempotentHint` in `tools/list`.
- Logs to stderr only, with the tool name and the error type, never arguments or replies.
- Replays eval cases in CI without a model, and runs the same cases against any
  OpenAI-compatible endpoint.

## Try the demo

The demo is an in-memory household todo list with invented data. Clone and build it first:

```sh
git clone https://github.com/woutersm/heim-mcp.git
cd heim-mcp
npm ci && npm run build
```

The build puts the `heim-mcp-demo` server at `dist/bin/demo.js`.

Claude Code, from the clone:

```sh
claude mcp add heim-demo -- node "$PWD/dist/bin/demo.js"
```

Claude Desktop, in `claude_desktop_config.json`, with the absolute path to your clone:

```json
{
  "mcpServers": {
    "heim-demo": {
      "command": "node",
      "args": ["/absolute/path/to/heim-mcp/dist/bin/demo.js"]
    }
  }
}
```

| Tool | Does | Annotations |
| --- | --- | --- |
| `todo_add` | adds a todo with `title`, optional `list` (`home`, `shopping`, `garden`) and `due` (`YYYY-MM-DD`, `today`, `tomorrow`) | |
| `todo_list` | lists open todos, optionally for one `list`, or done ones with `done: true` | read-only |
| `todo_done` | marks todo `id` as done | idempotent |
| `todo_delete` | deletes todo `id` | destructive |
| `todo_search` | finds todos whose title contains `query` | read-only |

## Define your own tools

Until heim-mcp is on npm, install it into your project from a built clone with
`npm install /path/to/heim-mcp`.

```ts
import Type from "typebox";
import { serveStdio, ToolError, type ToolBackend } from "heim-mcp";

const backend: ToolBackend = {
  tools: () => [
    {
      name: "todo_done",
      description: "Mark a todo as done.",
      parameters: Type.Object({ id: Type.Integer({ minimum: 1, description: "The todo's id" }) }),
      annotations: { readOnlyHint: false, idempotentHint: true },
      argAliases: { todo_id: "id" },
    },
  ],
  call(name, args) {
    const todo = todos.get(args.id as number);
    if (!todo) throw new ToolError(`No todo #${args.id}. Use todo_list to see the ids.`);
    todo.done = true;
    return `Done: #${todo.id} '${todo.title}'.`;
  },
};

await serveStdio(backend, { name: "my-todos", version: "1.0.0" });
```

A `ToolDef` has a `name`, a `description`, flat `parameters`, and optional `annotations`,
`argAliases` (alias to argument) and `valueAliases` (per argument, alias to enum value).
`call` receives clean arguments and returns the text the model reads. A `ToolError` reaches
the model as its message. Any other error reaches the model as an internal-error sentence.

`prepareArguments(tool, raw)` exports the validator on its own.

## Argument handling

Before the schema check, heim-mcp:

- parses arguments that arrive as a JSON string
- drops arguments whose value is `null`, and optional arguments sent as an empty or blank string
- trims whitespace around argument names, renames aliases from `argAliases`, and matches
  argument names in any case
- converts `"3"` to `3` for an integer, `"true"` to `true` for a boolean, and `42` to `"42"`
  for a string
- matches enum values in any case, and through `valueAliases` (`Groceries` and `boodschappen`
  become `shopping`)

An unknown argument does not fail the call. heim-mcp drops it, runs the tool, and adds one
sentence after the reply:

```
Added #9 'Milk' to home.
Ignored unknown argument 'colour'. todo_add takes: title, list, due.
```

In the eval, a 2B model whose call was rejected over an unknown argument then answered as if
the call had worked. Dropping the argument does what it meant, and the sentence still tells it
what the tool takes. When a
call fails for another reason, the unknown argument is named in the error as well.

The schema the model sees in `tools/list` stays strict.

## Error sentences

Each problem gets one sentence that names what is allowed:

```
Missing argument 'title'.
Argument 'id' must be an integer.
Argument 'list' must be one of: home, shopping, garden.
Unknown tool 'todo_finish'. Tools: todo_add, todo_list, todo_done, todo_delete, todo_search.
```

heim-mcp returns these as results with `isError: true`. A handler that throws produces a
JSON-RPC error instead, which the client sees and the model does not.

## Eval

A case file lists messages a person might send, the tool calls that should follow, and the
exact reply to each call.

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

Replay mode runs each case against a fresh backend through an MCP client over an in-memory
transport, and compares each reply to the golden text. It needs no model and runs in CI on
every push. From a built clone:

```sh
npx heim-mcp-eval --replay
```

Model mode sends each message to an OpenAI-compatible `/chat/completions` endpoint, such as
llama.cpp, LM Studio, Ollama or vLLM, with the tools from the server's `tools/list`. It
compares each call after the validator's corrections, ignores extra read-only lookups, and
skips cases marked `replay_only`. A call the server turns away at the argument check does not
count: the model reads the error and may retry, and only the calls that ran are scored. Each
case line also shows what the check corrected (`list "Groceries"→"shopping"`) and which calls
it rejected, and a `calls:` line totals them. Set
`OPENAI_API_KEY` if the endpoint needs a key, and `--reasoning-effort none` to turn thinking
off on a server that supports it.

```sh
npx heim-mcp-eval --base-url http://localhost:8080/v1 --model qwen3-30b-a3b
```

`--plain` runs the same cases against the same tools with the argument check of a plain MCP
server: unknown keys dropped, everything else checked against the schema as sent, and a miss
answered with the SDK's `Input validation error` text. The difference between the two scores
is what heim-mcp's corrections and error sentences are worth for that model.

```sh
npx heim-mcp-eval --base-url http://localhost:8080/v1 --model qwen3-30b-a3b --plain
```

The demo has 23 cases: 17 are scored in model mode and 6 are `replay_only`. Replay passes
23 of 23. On the first 9 scored cases, Qwen3.8-27B (4-bit, local) passes 9 of 9 in model mode.

## Why these rules

The rules come from heim, a private assistant for one
household that runs on a local model with eleven tools.

- Its users write Dutch and English, so every parser accepts aliases in both.
- Small models get nested arguments wrong more often than they get a second tool call wrong,
  so arguments are flat.
- Over stdio, stdout carries the protocol. One `console.log` corrupts the stream, and the
  client reports a parse error far from the cause.
- An OpenAI-compatible assistant message that calls a tool often has no `content` key at all.
  The eval's model loop treats it as absent.
- A delete without `destructiveHint` gets the same trust from a client as a read.

## Privacy

A tool's reply goes into the context of the client's model. With Claude Desktop that is
Anthropic's API. With a local model it stays on your machine. heim-mcp makes no network
calls of its own.

## Develop

```sh
npm ci
npm run typecheck && npm test && npm run build
npx heim-mcp-eval --replay
```

No test touches the network, spawns a process or starts a server.

## License

MIT
