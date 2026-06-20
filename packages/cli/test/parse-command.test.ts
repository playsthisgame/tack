import { describe, expect, test } from "bun:test";
import { parseCommand } from "../src/index";

describe("parseCommand", () => {
  test("no subcommand routes to the TUI", () => {
    expect(parseCommand([])).toEqual({ kind: "tui" });
  });

  test("score and dispatch route to their subcommands, not the TUI", () => {
    expect(parseCommand(["score", "rename x"])).toEqual({
      kind: "score",
      args: ["rename x"],
    });
    expect(parseCommand(["dispatch", "explain this"])).toEqual({
      kind: "dispatch",
      args: ["explain this"],
    });
  });

  test("help flags print usage, not the TUI", () => {
    expect(parseCommand(["--help"])).toEqual({ kind: "help" });
    expect(parseCommand(["-h"])).toEqual({ kind: "help" });
  });

  test("an unrecognized command is reported as unknown", () => {
    expect(parseCommand(["frobnicate"])).toEqual({
      kind: "unknown",
      cmd: "frobnicate",
    });
  });
});
