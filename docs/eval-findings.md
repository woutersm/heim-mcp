# Where heim-mcp makes a difference: findings, 2026-10-27

An exploration, not a benchmark: one condition changed at a time, to see where heim-mcp's
corrections and error sentences change the outcome. Setup: oMLX 0.7.3 on an Apple M4 Pro (48 GB),
Qwen3.5 0.8B/2B/4B/9B (MLX 4-bit, oMLX's MLX engine) and Qwen3.8-27B (UD-Q4_K_M, Splash engine),
temperature 0, thinking off. Three repeated runs gave identical output, so each condition ran once.

"heim" serves the demo tools through heim-mcp; "plain" through the argument check of an MCP SDK
server (`npx heim-mcp-eval --plain`). Scores count only calls that ran; a rejected call the model
then retried correctly passes.

## Reproduce

Every row is one `heim-mcp-eval` run, once as is and once with `--plain`:

| Column | Option |
| --- | --- |
| Cases: English / Dutch | `--cases eval/demo-cases.json` / `--cases eval/nl-cases.json` |
| Tools: no descriptions | `--no-descriptions` |
| Tools: 11 tools | `--extra-tools` |
| History: 12 earlier turns | `--history` |
| Requests the tools cannot do | `--cases eval/impossible-cases.json` |

The numbers below came from the exploration script these options replace. They have not yet
been rerun with `heim-mcp-eval` itself; one known difference is that the script counted
`"tomorrow"` and `"2026-03-03"` as the same `due`, and the eval does not.

For example, the 2B without descriptions:

```sh
npx heim-mcp-eval --base-url http://m4:8000/v1 --model Qwen3.5-2B-MLX-4bit \
  --reasoning-effort none --no-descriptions
npx heim-mcp-eval --base-url http://m4:8000/v1 --model Qwen3.5-2B-MLX-4bit \
  --reasoning-effort none --no-descriptions --plain
```

## Results

| Model | Cases | Tools | History | heim | plain |
| --- | --- | --- | --- | --- | --- |
| 0.8B | English | demo | none | 7/17 | 7/17 |
| 0.8B | English | no descriptions | none | 3/17 | 4/17 |
| 0.8B | English | 11 tools | none | 1/17 | 1/17 |
| 0.8B | English | demo | 12 earlier turns | 1/17 | 1/17 |
| 0.8B | Dutch | demo | none | 2/16 | 2/16 |
| 2B | English | demo | none | 10/17 | 10/17 |
| 2B | English | no descriptions | none | 12/17 | 12/17 |
| 2B | English | 11 tools | none | 10/17 | 9/17 |
| 2B | English | demo | 12 earlier turns | 9/17 | 9/17 |
| 2B | Dutch | demo | none | 7/16 | 7/16 |
| 2B | Dutch | 11 tools | 12 earlier turns | 9/16 | 9/16 |
| 4B | English | demo | none | 15/17 | 15/17 |
| 4B | English | no descriptions / 11 tools / history | | 14–15/17 | same |
| 4B | Dutch | demo or 11 tools + history | | 14–15/16 | same |
| 9B | English | demo | none | 17/17 | 17/17 |
| 9B | Dutch | demo, or 11 tools + history | | 16/16 | 16/16 |
| 27B | English | demo | none | 17/17 | 17/17 |

Across the exploration runs heim-mcp corrected 0 of 342 calls and rejected 10; the plain check dropped an
unknown key 4 times and rejected 1.

## What this says

1. **Qwen3.5 sends schema-correct arguments.** Not one wrong-case enum, alias, number-as-string
   or Dutch list name in any condition, at any size. The `enum` in the schema steers it, even
   for "boodschappen" or "tuin". The corrections heim-mcp makes came from other models: Llama
   3.2 3B sent `"list": "groceries"` (oMLX did not parse its tool calls, so it is not in the
   table).
2. **Below 4B the failures are about meaning,** and no argument check can fix them: the whole
   sentence as the title ("Put milk on the groceries"), a guessed id 1 instead of a lookup, no
   tool call at all (most of the 0.8B's misses), a valid but wrong list.
3. **A request the tools cannot do never reaches the error sentences.** For "the school list",
   "the bakery list" or "kantoorlijst" every model picked a valid list itself and said it had
   done what was asked; the 2B even answered "Koffie is op de kantoorlijst". The enum prevents
   the error that would have explained it.
4. **Where the two differ, it is unknown arguments.** heim-mcp rejects them with a sentence; the
   plain check drops them and runs. That cut both ways:
   - The 0.8B added `"done": "false"` to `todo_add`: plain dropped it and passed; heim-mcp
     rejected it and the retry went wrong.
   - The 2B sent `"priority": "high"`: plain dropped it and added the todo; heim-mcp rejected it
     and the model answered "I've added the task" without retrying, so nothing was added.
   - The 2B sent `"list\n": "garden"`: heim-mcp rejected it and the model retried correctly;
     plain dropped the key and listed every list.
5. **Two mistakes no current correction handles:** the 2B sent `"list": "", "due": ""` for
   optional arguments (both checks reject it, and the 2B never recovered), and a key with a
   trailing newline.

## Changes the evidence points to

- Read an empty string for an optional argument as absent, the way `null` already is.
- Trim whitespace from argument names before matching them.
- Reconsider unknown arguments: drop them and run, and say so in the reply ("Ignored
  'priority': todo_add takes title, list, due."), rather than reject. Small models handled a
  rejection worse than a quiet drop; the newline case is covered by trimming.

Each would have turned a failed case into a passed one above, and each needs its own test
before it changes `prepareArguments`.

## After the changes (2026-10-28)

All three went in (see `docs/decisions.md`). The heim side was run again under the same
conditions; the plain side did not change.

| Model | Condition | plain | heim before | heim after | What changed |
| --- | --- | --- | --- | --- | --- |
| 0.8B | English, no descriptions | 4/17 | 3/17 | 4/17 | `"done": "false"` on `todo_add` dropped, not rejected |
| 2B | English, no descriptions | 12/17 | 12/17 | 13/17 | `"list": "", "due": ""` read as absent |
| 2B | English, 11 tools | 9/17 | 10/17 | 10/17 | `"list\n"` trimmed; no rejection and retry needed |
| 2B | "with priority high" | added | nothing added, model said it was | added, with the note | unknown `priority` dropped |

Every other condition scored the same as before and the same as plain. heim-mcp now corrected 5
calls and rejected none; before it corrected 0 and rejected 10.

So, on Qwen3.5: heim-mcp no longer does worse than a plain server anywhere, and does better in
two conditions, both for the 2B. From 4B up the two are identical. The gain is small and
specific: it shows up when a small model gets tool definitions without descriptions or many
tools, which is when it starts sending empty values and stray keys.
