import { describe, expect, test } from "bun:test";
import {
  DeviceFlowError,
  defaultCopilotConfig,
  pollForAccessToken,
  requestDeviceCode,
  type DeviceCodeResult,
} from "../src/index";

const config = defaultCopilotConfig;

/** A fetch stub returning a JSON body and capturing the requests it received. */
function jsonFetch(
  bodies: unknown[],
  calls: { url: string; init?: RequestInit }[] = [],
): typeof fetch {
  let i = 0;
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const noSleep = async (): Promise<void> => {};

const device: DeviceCodeResult = {
  deviceCode: "dev-code",
  userCode: "WXYZ-1234",
  verificationUri: "https://github.com/login/device",
  expiresIn: 900,
  interval: 1,
};

describe("requestDeviceCode", () => {
  test("returns the parsed codes and sends Accept: application/json", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchStub = jsonFetch(
      [
        {
          device_code: "dc",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 899,
          interval: 5,
        },
      ],
      calls,
    );

    const result = await requestDeviceCode(config, { fetch: fetchStub });

    expect(result.userCode).toBe("ABCD-1234");
    expect(result.deviceCode).toBe("dc");
    expect(result.interval).toBe(5);
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get("Accept")).toBe("application/json");
  });

  test("throws on an error response", async () => {
    const fetchStub = jsonFetch([{ error: "invalid_client", error_description: "bad client" }]);
    await expect(requestDeviceCode(config, { fetch: fetchStub })).rejects.toThrow(DeviceFlowError);
  });
});

describe("pollForAccessToken", () => {
  test("continues past authorization_pending then returns the token on success", async () => {
    const fetchStub = jsonFetch([
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { access_token: "gho_success" },
    ]);
    const token = await pollForAccessToken(config, device, { fetch: fetchStub, sleep: noSleep });
    expect(token).toBe("gho_success");
  });

  test("backs off on slow_down and still succeeds", async () => {
    const sleeps: number[] = [];
    const fetchStub = jsonFetch([{ error: "slow_down" }, { access_token: "gho_ok" }]);
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
    };
    const token = await pollForAccessToken(config, device, { fetch: fetchStub, sleep });
    expect(token).toBe("gho_ok");
    // First wait at the interval (1s), second after a +5s backoff.
    expect(sleeps[0]).toBe(1000);
    expect(sleeps[1]).toBe(6000);
  });

  test("throws a typed error on expired_token", async () => {
    const fetchStub = jsonFetch([{ error: "expired_token" }]);
    await expect(
      pollForAccessToken(config, device, { fetch: fetchStub, sleep: noSleep }),
    ).rejects.toMatchObject({ code: "expired_token" });
  });

  test("throws a typed error on access_denied", async () => {
    const fetchStub = jsonFetch([{ error: "access_denied" }]);
    await expect(
      pollForAccessToken(config, device, { fetch: fetchStub, sleep: noSleep }),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
});
