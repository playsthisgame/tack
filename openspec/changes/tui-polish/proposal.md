## Why

The current TUI is functional but bare: there is no visual framing around the input area, no context shown at startup, and no feedback while the model is generating a response. These gaps make the interface feel unfinished and leave users uncertain about what Tack supports and whether a request is in flight.

## What Changes

- Add a bordered box around the prompt input area so it is visually distinct from the transcript
- Show a welcome panel on first launch listing tier→model mappings and basic keybindings, similar to Claude Code's startup screen
- Display a loading/spinner indicator on the active turn while dispatch is in progress and the model has not yet responded

## Capabilities

### New Capabilities

- `tui-welcome`: Static welcome panel shown at startup, displaying tier-to-model mappings and key keybindings; dismissed once the first prompt is submitted
- `tui-input-chrome`: Visual border framing the prompt input area to make it clearly identifiable as the typing target
- `tui-loading-indicator`: Per-turn spinner shown while a dispatch is in flight and no response chunks have arrived yet

### Modified Capabilities

- `tui-shell`: The interactive prompt loop gains visual chrome (input border, welcome panel, loading indicator); no requirement-level behavior changes, but the presentation contract for each turn expands

## Impact

- `packages/tui/src/app.tsx`: all visual changes live here (input box border, welcome panel component, spinner on active turn)
- `packages/tui/src/useTack.ts`: `Turn` type may gain an `inFlight` flag to drive the loading indicator
- No new dependencies expected — Ink's `<Box borderStyle>` covers the border; a spinner can be implemented with a simple interval or the existing Ink primitives
