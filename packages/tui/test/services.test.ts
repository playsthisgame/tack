import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServices } from "../src/services";

/**
 * Exercise the connect-routing surface without touching real config/secrets:
 * point every store at an in-memory DB / temp directory. The scorer and
 * dispatcher build lazily, so constructing services loads no model.
 */
describe("connect routing", () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tack-services-"));
    for (const k of [
      "TACK_DB_PATH",
      "TACK_COPILOT_DB_PATH",
      "TACK_CONFIG_PATH",
      "XDG_CONFIG_HOME",
      "ANTHROPIC_API_KEY",
    ]) {
      saved[k] = process.env[k];
    }
    process.env.TACK_DB_PATH = ":memory:";
    process.env.TACK_COPILOT_DB_PATH = ":memory:";
    process.env.TACK_CONFIG_PATH = join(dir, "config.json");
    process.env.XDG_CONFIG_HOME = join(dir, "config");
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("Copilot is offered as a browser-sign-in provider", () => {
    const services = createServices();
    const copilot = services.providers().find((p) => p.name === "copilot");
    expect(copilot).toBeDefined();
    expect(copilot!.browserSignIn).toBe(true);
    // It is NOT connected purely from auth state on a fresh in-memory store.
    expect(copilot!.connected).toBe(false);
  });

  test("connecting Copilot routes to the device flow, not a key prompt", () => {
    const services = createServices();
    const result = services.connectProvider("copilot");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("device");
  });

  test("connecting a key-based provider routes to the key path", () => {
    const services = createServices();
    const result = services.connectProvider("anthropic");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("key");
      if (result.kind === "key") expect(result.needsKey).toBe(true);
    }
  });
});
