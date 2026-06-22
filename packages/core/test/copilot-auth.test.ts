import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CopilotAuth,
  DEFAULT_COPILOT_ACCOUNT,
  GithubTokenRejectedError,
  redactedAuthState,
  SqliteCopilotAuthStore,
} from "../src/index";

/**
 * A fetch stub for the Copilot token-exchange endpoint. Returns a bearer with a
 * configurable expiry, or a 401 to simulate a rejected GitHub token, and counts
 * how many exchanges happened.
 */
function exchangeFetch(opts: {
  token?: string;
  expiresInSec?: number;
  reject?: boolean;
  counter?: { n: number };
}): typeof fetch {
  return (async () => {
    if (opts.counter) opts.counter.n++;
    if (opts.reject) return new Response("nope", { status: 401 });
    const expiresAt = Math.floor(Date.now() / 1000) + (opts.expiresInSec ?? 1500);
    return new Response(JSON.stringify({ token: opts.token ?? "copilot-bearer", expires_at: expiresAt }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("CopilotAuth.ensureFreshToken", () => {
  let store: SqliteCopilotAuthStore;

  beforeEach(() => {
    store = new SqliteCopilotAuthStore(":memory:");
    store.set({ accountId: DEFAULT_COPILOT_ACCOUNT, githubToken: "gho_user" });
  });

  afterEach(() => store.close());

  test("exchanges and caches on first use", async () => {
    const counter = { n: 0 };
    const auth = new CopilotAuth({ store, fetch: exchangeFetch({ counter }) });
    const token = await auth.ensureFreshToken();
    expect(token).toBe("copilot-bearer");
    expect(counter.n).toBe(1);
    expect(store.get(DEFAULT_COPILOT_ACCOUNT)?.copilotToken).toBe("copilot-bearer");
  });

  test("reuses a cached token that is well within its lifetime", async () => {
    const counter = { n: 0 };
    const auth = new CopilotAuth({ store, fetch: exchangeFetch({ counter, expiresInSec: 3600 }) });
    await auth.ensureFreshToken();
    await auth.ensureFreshToken();
    expect(counter.n).toBe(1); // second call served from cache
  });

  test("refreshes a token within the expiry threshold", async () => {
    const counter = { n: 0 };
    // Default threshold is 300s; an 120s-lived token is already inside it.
    const auth = new CopilotAuth({ store, fetch: exchangeFetch({ counter, expiresInSec: 120 }) });
    await auth.ensureFreshToken();
    await auth.ensureFreshToken();
    expect(counter.n).toBe(2); // forced to re-exchange each time
  });

  test("throws a typed error when the GitHub token is rejected", async () => {
    const auth = new CopilotAuth({ store, fetch: exchangeFetch({ reject: true }) });
    await expect(auth.ensureFreshToken()).rejects.toBeInstanceOf(GithubTokenRejectedError);
  });

  test("throws when no GitHub token is stored", async () => {
    const empty = new SqliteCopilotAuthStore(":memory:");
    const auth = new CopilotAuth({ store: empty, fetch: exchangeFetch({}) });
    await expect(auth.ensureFreshToken()).rejects.toBeInstanceOf(GithubTokenRejectedError);
    empty.close();
  });
});

describe("CopilotAuth.connect", () => {
  test("reuses a valid OpenCode token without the device flow", async () => {
    const store = new SqliteCopilotAuthStore(":memory:");
    const auth = new CopilotAuth({
      store,
      fetch: exchangeFetch({}), // exchange succeeds => OpenCode token is valid
      findOpencodeToken: () => "gho_from_opencode",
    });
    await auth.connect();
    expect(store.get(DEFAULT_COPILOT_ACCOUNT)?.githubToken).toBe("gho_from_opencode");
    store.close();
  });

  test("falls back to the device flow when the OpenCode token is invalid", async () => {
    const store = new SqliteCopilotAuthStore(":memory:");
    // Exchange rejects (token invalid) on the validation attempt, then the device
    // flow's own endpoints take over via the same stub returning device data.
    let stage = 0;
    const fetchStub = (async (url: string | URL | Request) => {
      const u = String(url);
      stage++;
      if (u.includes("copilot_internal")) {
        return new Response("nope", { status: 401 }); // OpenCode token rejected
      }
      if (u.includes("device/code")) {
        return new Response(
          JSON.stringify({ device_code: "dc", user_code: "AAAA", verification_uri: "u", expires_in: 60, interval: 1 }),
          { status: 200 },
        );
      }
      // access_token endpoint
      return new Response(JSON.stringify({ access_token: "gho_device" }), { status: 200 });
    }) as unknown as typeof fetch;

    const auth = new CopilotAuth({
      store,
      fetch: fetchStub,
      sleep: async () => {},
      findOpencodeToken: () => "gho_invalid",
    });
    let shownCode: string | undefined;
    await auth.connect({ onUserCode: (d) => (shownCode = d.userCode) });
    expect(shownCode).toBe("AAAA");
    expect(store.get(DEFAULT_COPILOT_ACCOUNT)?.githubToken).toBe("gho_device");
    expect(stage).toBeGreaterThan(1);
    store.close();
  });
});

describe("secret handling", () => {
  test("redactedAuthState reduces tokens to booleans and never leaks values", () => {
    const state = {
      accountId: "default",
      githubToken: "gho_secret",
      copilotToken: "bearer_secret",
      copilotExpiresAt: 123,
    };
    const redacted = redactedAuthState(state);
    expect(redacted).toEqual({ accountId: "default", hasGithubToken: true, hasCopilotToken: true });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("gho_secret");
    expect(serialized).not.toContain("bearer_secret");
  });

  test("status() on CopilotAuth exposes no token values", async () => {
    const store = new SqliteCopilotAuthStore(":memory:");
    store.set({ accountId: DEFAULT_COPILOT_ACCOUNT, githubToken: "gho_top_secret" });
    const auth = new CopilotAuth({ store, fetch: exchangeFetch({}) });
    expect(JSON.stringify(auth.status())).not.toContain("gho_top_secret");
    store.close();
  });
});
