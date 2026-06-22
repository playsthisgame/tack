# tack

A local-first AI prompt router. Tack scores each prompt with fast, transparent
heuristics and routes it to the cheapest model that can handle it well — with
every routing decision fully inspectable.

> POC status: the scoring engine, the CLI `score` command, and SQLite logging
> of every routing decision work today. Model dispatch and the TUI are upcoming
> changes.

## Why

Most AI coding workflows send every prompt to a frontier model, paying top rates
to rename a variable. Tack routes easy prompts to cheap models and hard prompts
to capable ones. Unlike a black-box router, Tack shows you *why* each prompt
routed where it did and lets you tune the weights.

## Stack

- Runtime: Bun
- Language: TypeScript (strict)
- Monorepo: Bun workspaces
- Tokenizer: js-tiktoken (behind a swappable interface)
- Dispatch (later): Vercel AI SDK (`ai`) against provider APIs directly
- Storage (later): `bun:sqlite`
- TUI (later): Ink

## Layout

```
packages/
  core/   scoring engine, signals, tokenizer — no I/O, no provider code
  cli/    command-line entry point
  tui/    Ink interface (placeholder for now)
```

`core` knows nothing about how prompts arrive or where responses go. That clean
boundary is what lets the same scorer later power a proxy or a Claude Code hook
without a rewrite.

## Install

Tack is a [Bun](https://bun.sh) program (it uses `bun:sqlite`), so you need Bun
installed. With Bun on your PATH:

```bash
npm install -g @playsthisgame/tack
tack score "refactor the auth module"
```

## Setup (from source)

```bash
bun install
```

## Try the scorer

```bash
bun run tack score "rename this variable to userId"
bun run tack score "Why am I getting this TypeError? at handler (server.ts:42:13)"
bun run tack score "Help me architect a refactor of the auth module"
```

Each prints the chosen tier, the model, the score, and the full signal
breakdown.

Every decision is also persisted to a local SQLite database (default
`./.tack/tack.db`) so weights can be calibrated against real history later. Pass
`--no-log` to skip persistence, or set `TACK_DB_PATH` to change the location:

```bash
bun run tack score "rename this variable" --no-log
TACK_DB_PATH=/tmp/tack.db bun run tack score "refactor the auth module"
```

## Dispatch (call the model)

`dispatch` scores a prompt, shows the routing decision, then calls the routed
tier's model via the Vercel AI SDK and streams the response. It needs the API
key for that model's provider in the environment (see `.env.example`):

```bash
ANTHROPIC_API_KEY=sk-... bun run tack dispatch "Explain this stack trace"
```

The model is configured as a `provider/model` string per tier in
`core/src/config.ts`; supported providers are `anthropic`, `openai`, and
`google`. `--no-log` and `TACK_DB_PATH` work here too.

## Context-window awareness

A prompt's complexity and its context *size* are independent: a one-line prompt
riding on a huge conversation still needs a model whose window can hold it. Tack
treats each tier model's context window as a hard routing constraint. The
complexity score chooses a *preferred* tier; if that tier's model can't hold the
measured context (plus a response-headroom reserve), routing escalates to the
smallest tier that can. Every escalation is recorded as an inspectable
contribution (`escalated: context 150000 exceeds cheap window 200000`).

When context size repeatedly forces simple prompts up a tier, Tack surfaces a
**dismissible, advisory-only** hint that compacting the conversation could
restore cheaper routing, with an estimated saving. When the context exceeds
*every* model's window, Tack surfaces a **blocking** advisory that compaction is
required and dispatches nothing. This is **client-mode only**.

Tack never compacts or drops context on its own — compaction is lossy, so the
action always stays with you. The window sizes, headroom reserve, per-tier cost
figures, and advisory threshold are all tunable in `core/src/config.ts`.

### Testing routing without spending tokens

`tack route` simulates routing for a *sequence* of prompts and prints each
decision plus any advisory — but **never dispatches**, so it costs nothing and
needs no API key. Use the `tiny` window preset so escalation triggers on short
inputs:

```bash
bun run tack route --windows tiny "fix this typo" "rename x" "add a comment" "format file"
```

Each short prompt escalates past the tiny cheap window, and the compaction
advisory appears once the escalation threshold is crossed. A prompt larger than
every window prints the blocking advisory instead. Pass `--accumulate` to grow
the conversation turn-over-turn (so context size rises naturally), `--file
<path>` to read newline-separated prompts, or pipe them on stdin.

Each line shows the complexity `score` and the `context` size in tokens. Add
`--why` (or `-v`) to see the signal breakdown behind every decision — the same
rationale `tack score` prints, for each turn:

```bash
bun run tack route --why "what language does this use" "refactor this codebase"
# [1] cheap   —   (score 0, context 7 tokens)
#         why: (no signals fired — baseline cheap)
# [2] mid     —   (score 2, context 5 tokens)
#         +2  mentions "refactor"
```

By default `score` and `route` measure only the prompt (plus history). Real
dispatch also injects an environment system prompt — the working directory, a
file-tree snapshot, and git context (see `dispatch/src/context.ts`). Pass
`--context` to `route` to include that same system prompt so the token count and
routing match what `tack dispatch` would actually send:

```bash
bun run tack route --context --why "what language does this use"
# context: injecting environment system prompt (317 tokens — cwd, file tree, git)
# [1] cheap   —   (score 0, context 324 tokens)
```

## The TUI

Running `tack` with no subcommand launches the interactive TUI (Ink), the default
"Tack as client" experience:

```bash
bun run tack
```

Type a prompt and Tack shows the tier and model it routed to before streaming the
response; press `Ctrl-W` to reveal the signal breakdown for the latest turn, and
`Ctrl-D` to dismiss a context advisory when one appears. If the
routed model's provider key isn't set, the TUI prompts for it inline and saves it for
next time to a local secrets file (`$XDG_CONFIG_HOME/tack/credentials`, or
`~/.config/tack/credentials`) — kept separate from the scoring config. The `tack score`
and `tack dispatch` subcommands are unchanged.

## Test

```bash
bun test
```

## Roadmap

1. **scoring-engine** — heuristic scorer + CLI (done)
2. **sqlite-logging** — persist every routing decision for later tuning (done)
3. **model-dispatch** — call the chosen model via the AI SDK and stream output (done)
4. **tui-shell** — Ink interface wiring it together (done)
5. **embedding-classifier** — swap the heuristic Scorer for embedding centroids
   (same interface), keeping decisions local and fast

## Design notes

- Scoring weights/thresholds live in `core/src/config.ts`, never as magic
  numbers in logic.
- The `Scorer` interface is the swap point for the future embedding classifier.
- Token counts are approximate for non-OpenAI models; fine for coarse routing.
