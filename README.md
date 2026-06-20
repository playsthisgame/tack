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

## Setup

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

## The TUI

Running `tack` with no subcommand launches the interactive TUI (Ink), the default
"Tack as client" experience:

```bash
bun run tack
```

Type a prompt and Tack shows the tier and model it routed to before streaming the
response; press `Ctrl-W` to reveal the signal breakdown for the latest turn. If the
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
