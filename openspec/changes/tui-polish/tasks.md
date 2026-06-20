## 1. Extend Turn type with inFlight flag

- [x] 1.1 Add `inFlight: boolean` to the `Turn` interface in `useTack.ts`
- [x] 1.2 Set `inFlight: true` when a turn is created in `submit()`
- [x] 1.3 Flip `inFlight` to `false` when the first response chunk arrives in `streamInto()`
- [x] 1.4 Ensure `inFlight` is also set to `false` on done and on error

## 2. Spinner component

- [x] 2.1 Implement a `Spinner` component in `app.tsx` using `useEffect` + `setInterval` cycling braille frames at 80 ms
- [x] 2.2 Clean up the interval in the effect's return to prevent leaks

## 3. Loading indicator in TurnView

- [x] 3.1 Render `<Spinner>` in `TurnView` when `turn.inFlight && turn.response.length === 0`
- [x] 3.2 Verify spinner disappears once response text starts arriving

## 4. Input border

- [x] 4.1 Wrap the `TextInput` row in a `<Box borderStyle="round">` in `app.tsx`
- [x] 4.2 Confirm the border is absent when the `KeyPrompt` is shown instead

## 5. Welcome panel

- [x] 5.1 Implement a `WelcomePanel` component that reads `defaultConfig.tierModels` and renders the tier→model table
- [x] 5.2 Include active keybindings (`^w` why, `^c` quit) in the panel
- [x] 5.3 Render `<WelcomePanel>` in `App` when `turns.length === 0 && pendingKey === null`
- [x] 5.4 Verify the panel disappears after the first prompt is submitted

## 6. Smoke test

- [x] 6.1 Launch `tack` and confirm welcome panel shows tier→model table and keybindings
- [x] 6.2 Submit a prompt and confirm: panel disappears, spinner shows, spinner disappears when text arrives
- [x] 6.3 Confirm the input border is visible and the key prompt does not show it
