import { describe, expect, test } from "bun:test";
import { defaultCopilotConfig } from "@tack/core";
import {
  authedCopilotFetch,
  createCopilotProvider,
  MissingApiKeyError,
  registryWithCopilot,
  resolveModel,
  type TokenSource,
} from "../src/index";

const fakeAuth: TokenSource = { ensureFreshToken: async () => "fresh-bearer" };

describe("authedCopilotFetch", () => {
  test("injects the bearer token and every editor header on each request", async () => {
    let captured: Headers | undefined;
    const baseFetch = (async (_url: string, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return new Response("ok");
    }) as unknown as typeof fetch;

    const doFetch = authedCopilotFetch(fakeAuth, defaultCopilotConfig, baseFetch);
    await doFetch("https://api.githubcopilot.com/chat/completions", { method: "POST" });

    expect(captured!.get("Authorization")).toBe("Bearer fresh-bearer");
    expect(captured!.get("Copilot-Integration-Id")).toBe(
      defaultCopilotConfig.editorHeaders["Copilot-Integration-Id"],
    );
    expect(captured!.get("Editor-Version")).toBe(defaultCopilotConfig.editorHeaders["Editor-Version"]);
    expect(captured!.get("Editor-Plugin-Version")).toBe(
      defaultCopilotConfig.editorHeaders["Editor-Plugin-Version"],
    );
    expect(captured!.get("User-Agent")).toBe(defaultCopilotConfig.editorHeaders["User-Agent"]);
  });

  test("calls ensureFreshToken once per request", async () => {
    let calls = 0;
    const auth: TokenSource = {
      ensureFreshToken: async () => {
        calls++;
        return "tok";
      },
    };
    const baseFetch = (async () => new Response("ok")) as unknown as typeof fetch;
    const doFetch = authedCopilotFetch(auth, defaultCopilotConfig, baseFetch);
    await doFetch("https://example.com");
    await doFetch("https://example.com");
    expect(calls).toBe(2);
  });
});

describe("createCopilotProvider", () => {
  test("returns a standard AI-SDK LanguageModel handle", () => {
    const { model } = createCopilotProvider({ auth: fakeAuth });
    const languageModel = model("gpt-4o");
    // The dispatcher consumes this through the same shape as any other provider.
    expect(languageModel).toBeDefined();
    expect(typeof (languageModel as { doStream?: unknown }).doStream).toBe("function");
  });
});

describe("registry integration", () => {
  test("a Copilot model resolves with no API key required", () => {
    const registry = registryWithCopilot(
      { ensureFreshToken: async () => "tok" } as unknown as Parameters<typeof registryWithCopilot>[0],
    );
    // resolveModel would throw MissingApiKeyError for a key-based provider with no
    // key; Copilot has no envVar, so it resolves against an empty environment.
    const model = resolveModel("copilot/gpt-4o", registry, {});
    expect(model).toBeDefined();
  });

  test("key-based providers still require their API key", () => {
    expect(() => resolveModel("anthropic/claude-haiku-4-5", undefined, {})).toThrow(
      MissingApiKeyError,
    );
  });
});
