import type { CopilotConfig } from "./copilot-config";

/** A pluggable `fetch`, so the device flow can be driven against mock endpoints in tests. */
export type FetchLike = typeof fetch;

/** Injectable async sleep, so polling tests run without real delays. */
export type SleepFn = (ms: number) => Promise<void>;

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The device-code response, surfaced to the caller so it can display the user
 * code and verification URL while polling proceeds.
 */
export interface DeviceCodeResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds until the user/device codes expire. */
  expiresIn: number;
  /** Minimum seconds between access-token polls, per GitHub. */
  interval: number;
}

/** Thrown when the device flow cannot complete (expiry, denial, or a hard error). */
export class DeviceFlowError extends Error {
  constructor(
    message: string,
    /** The GitHub error code (`expired_token`, `access_denied`, …) when present. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DeviceFlowError";
  }
}

interface DeviceFlowOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
}

/**
 * Request a device + user code from GitHub. Sends `Accept: application/json` so
 * the response is JSON rather than form-encoded. Returns the codes and the
 * polling interval the caller must honor.
 */
export async function requestDeviceCode(
  config: CopilotConfig,
  options: DeviceFlowOptions = {},
): Promise<DeviceCodeResult> {
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(config.deviceCodeUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, scope: config.scope }),
  });
  if (!res.ok) {
    throw new DeviceFlowError(`device-code request failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };
  if (data.error || !data.device_code || !data.user_code) {
    throw new DeviceFlowError(
      data.error_description ?? data.error ?? "malformed device-code response",
      data.error,
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? "https://github.com/login/device",
    expiresIn: data.expires_in ?? 900,
    interval: data.interval ?? 5,
  };
}

/**
 * Poll the access-token endpoint until the user authorizes (success), the codes
 * expire, or access is denied. Honors the returned `interval`, continues on
 * `authorization_pending`, and backs off the documented +5s on `slow_down`.
 * Resolves with the GitHub OAuth token on success.
 */
export async function pollForAccessToken(
  config: CopilotConfig,
  device: DeviceCodeResult,
  options: DeviceFlowOptions = {},
): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? realSleep;

  let intervalMs = device.interval * 1000;
  const deadline = Date.now() + device.expiresIn * 1000;

  // Loop until the codes' own expiry; GitHub also signals `expired_token` itself.
  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const res = await doFetch(config.accessTokenUrl, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (data.access_token) return data.access_token;

    switch (data.error) {
      case "authorization_pending":
        continue; // keep waiting at the current interval
      case "slow_down":
        // GitHub asks us to back off; the documented increment is +5s.
        intervalMs += 5000;
        continue;
      case "expired_token":
        throw new DeviceFlowError("the device code expired before authorization", "expired_token");
      case "access_denied":
        throw new DeviceFlowError("authorization was denied", "access_denied");
      default:
        throw new DeviceFlowError(
          data.error_description ?? data.error ?? "access-token polling failed",
          data.error,
        );
    }
  }

  throw new DeviceFlowError("the device code expired before authorization", "expired_token");
}
