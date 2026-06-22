import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfig,
  FileConfigStore,
  loadConfig,
  lookupModel,
  type ConfigStore,
  type TierModelConfig,
} from "../src/index";

describe("loadConfig", () => {
  test("no store returns the defaults unchanged", () => {
    const cfg = loadConfig();
    expect(cfg.tierModels).toEqual(defaultConfig.tierModels);
    expect(cfg.tierWindows).toEqual(defaultConfig.tierWindows);
    expect(cfg.tierCostPer1M).toEqual(defaultConfig.tierCostPer1M);
  });

  test("an override updates model, window, and cost together; other tiers keep defaults", () => {
    const store: ConfigStore = {
      load: (): TierModelConfig => ({
        frontier: { model: "openai/gpt-x", window: 256_000, costPer1M: 9 },
      }),
      save: () => {},
    };
    const cfg = loadConfig(store);
    expect(cfg.tierModels.frontier).toBe("openai/gpt-x");
    expect(cfg.tierWindows.frontier).toBe(256_000);
    expect(cfg.tierCostPer1M.frontier).toBe(9);
    // Untouched tiers keep their defaults.
    expect(cfg.tierModels.cheap).toBe(defaultConfig.tierModels.cheap);
    expect(cfg.tierWindows.cheap).toBe(defaultConfig.tierWindows.cheap);
  });
});

describe("model catalog", () => {
  test("lookupModel returns window/cost for a known model", () => {
    expect(lookupModel("anthropic/claude-opus-4-8")).toEqual({ window: 1_000_000, costPer1M: 5 });
  });

  test("lookupModel is undefined for an unknown model", () => {
    expect(lookupModel("acme/whatever")).toBeUndefined();
  });
});

describe("FileConfigStore", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tack-cfg-"));
    path = join(dir, "config.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("round-trips a saved override and merges through loadConfig", () => {
    const store = new FileConfigStore(path);
    store.save("mid", { model: "anthropic/claude-haiku-4-5", window: 200_000, costPer1M: 1 });

    const reopened = new FileConfigStore(path);
    expect(reopened.load().mid).toEqual({
      model: "anthropic/claude-haiku-4-5",
      window: 200_000,
      costPer1M: 1,
    });
    expect(loadConfig(reopened).tierModels.mid).toBe("anthropic/claude-haiku-4-5");
  });

  test("a missing file loads as empty without throwing", () => {
    expect(new FileConfigStore(join(dir, "nope.json")).load()).toEqual({});
  });

  test("a corrupt file or malformed entry loads as empty without throwing", () => {
    writeFileSync(path, "{ not json");
    expect(new FileConfigStore(path).load()).toEqual({});

    writeFileSync(path, JSON.stringify({ tiers: { mid: { model: 123 } } }));
    expect(new FileConfigStore(path).load()).toEqual({});
  });
});
