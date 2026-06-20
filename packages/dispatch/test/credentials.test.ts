import { describe, expect, test } from "bun:test";
import {
  requiredProviders,
  resolveKey,
  type SecretsStore,
} from "../src/index";

function fakeStore(initial: Record<string, string> = {}): SecretsStore {
  const data = new Map(Object.entries(initial));
  return {
    get: (p) => data.get(p),
    set: (p, k) => void data.set(p, k),
  };
}

describe("resolveKey layering", () => {
  test("env takes precedence", () => {
    const key = resolveKey("anthropic", {
      env: { ANTHROPIC_API_KEY: "from-env" },
      store: fakeStore({ anthropic: "from-store" }),
    });
    expect(key).toBe("from-env");
  });

  test("falls back to the secrets store when env is empty", () => {
    const key = resolveKey("anthropic", {
      env: {},
      store: fakeStore({ anthropic: "from-store" }),
    });
    expect(key).toBe("from-store");
  });

  test("returns undefined when neither source has the key", () => {
    const key = resolveKey("anthropic", { env: {}, store: fakeStore() });
    expect(key).toBeUndefined();
  });
});

describe("requiredProviders", () => {
  test("returns the distinct providers referenced by the tier models", () => {
    expect(
      requiredProviders({
        cheap: "anthropic/claude-haiku-4.5",
        mid: "anthropic/claude-sonnet-4.6",
        frontier: "openai/gpt-4o",
      }),
    ).toEqual(["anthropic", "openai"]);
  });

  test("does not request providers not in the config", () => {
    const providers = requiredProviders({
      cheap: "google/gemini-1.5-flash",
      mid: "google/gemini-1.5-pro",
      frontier: "google/gemini-1.5-pro",
    });
    expect(providers).toEqual(["google"]);
    expect(providers).not.toContain("anthropic");
  });
});
