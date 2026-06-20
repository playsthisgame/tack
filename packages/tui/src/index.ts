/**
 * Tack TUI — the interactive Phase 1 client.
 *
 * `runTui()` renders the Ink app wired to the real scorer, dispatcher, and
 * decision log. The CLI lazily imports this when `tack` is run with no
 * subcommand, so the lightweight `score`/`dispatch` commands never load Ink.
 */
export { App, runTui } from "./app";
export { useTack, type Turn } from "./useTack";
export { createServices, type TackServices } from "./services";
