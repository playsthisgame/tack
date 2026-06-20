## Context

The TUI is a single `app.tsx` file built on Ink (React for terminals). It currently renders a bare transcript and a plain `› ` prefix with `TextInput` — no border, no startup context, no in-flight feedback. All three features requested (input border, welcome panel, loading indicator) are purely presentational additions; they touch `app.tsx` and require a small extension to the `Turn` type in `useTack.ts`.

Ink supports `borderStyle` on `<Box>` natively (single, double, round, bold, etc.), so no new dependencies are needed for the border. A spinner can be implemented with `useEffect` + `setInterval` cycling through frame characters — also dependency-free.

## Goals / Non-Goals

**Goals:**
- Bordered input box that visually frames the active typing area
- Welcome panel shown at launch listing tier→model mappings and key keybindings; hides after the first prompt is submitted
- Per-turn loading indicator (spinner) visible while dispatch is in flight and no response text has arrived yet

**Non-Goals:**
- Animated progress bars, colour themes, or configurable styling
- Persistent status bar changes beyond what's already there
- Any change to routing logic, dispatch, or key management

## Decisions

### 1. Input border: `<Box borderStyle="round">` wrapping the input row

Ink's built-in `borderStyle` prop on `<Box>` renders a Unicode border around its children with no extra dependencies. `"round"` (╭─╮) reads as a text field; `"single"` is also acceptable. The border replaces the bare `› ` prefix, which moves inside the box.

**Alternative considered:** a plain `─────` rule above/below the input. Rejected — a full box is more obviously a text field.

### 2. Welcome panel: component dismissed by first submit

A `WelcomePanel` component reads `defaultConfig.tierModels` directly (it's already imported in `services.ts` and accessible from `@tack/core`) to render the tier→model table. It is shown when `turns.length === 0 && pendingKey === null`. Once the user submits a prompt, `turns.length > 0` and the panel disappears naturally — no extra state needed.

The panel also lists the two active keybindings (`^w` why, `^c` quit) so new users can discover them.

**Alternative considered:** a persistent header that always shows the model table. Rejected — it consumes vertical space once the user is in a flow.

### 3. Loading indicator: `inFlight` flag on `Turn` + `Spinner` component

`Turn` gains an `inFlight: boolean` field, set to `true` when the turn is created and flipped to `false` when the first chunk arrives (or when done/error is set). `TurnView` renders a `<Spinner>` in place of the response area when `inFlight && response.length === 0`.

The spinner cycles through `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (braille frames) via `useEffect` + `setInterval(80ms)` inside the `Spinner` component. The interval is cleaned up in the effect's return.

**Alternative considered:** Ink's third-party `ink-spinner` package. Rejected — a 10-frame braille cycle is trivial to implement inline, avoiding an extra dependency.

**Alternative considered:** a spinner on the status bar instead of per-turn. Rejected — per-turn makes it clear which turn is loading, especially in multi-turn sessions.

## Risks / Trade-offs

- **`setInterval` in Ink**: Ink re-renders on every state change; 80 ms ticks are fine for a terminal but will produce ~12 renders/second while a turn is in flight. This is standard for terminal spinners and acceptable.
- **Welcome panel width**: The tier→model table is rendered as fixed text; very narrow terminals may wrap it. Acceptable for a POC — no responsive layout needed.
- **`inFlight` flag timing**: The flag flips on the first chunk, so if the API is fast the spinner may flash briefly. This is correct behaviour and preferable to showing nothing.
