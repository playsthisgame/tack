import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractGithubTokenFromOpencode, findOpencodeGithubToken } from "../src/index";

describe("extractGithubTokenFromOpencode", () => {
  test("finds a gho_ token regardless of the surrounding key names", () => {
    // Shapes seen across OpenCode versions: different provider keys / token fields.
    expect(
      extractGithubTokenFromOpencode({ "github-copilot": { refresh: "gho_abc" } }),
    ).toBe("gho_abc");
    expect(extractGithubTokenFromOpencode({ copilot: { oauth: "gho_def" } })).toBe("gho_def");
    expect(extractGithubTokenFromOpencode({ github: { token: "gho_ghi" } })).toBe("gho_ghi");
  });

  test("ignores non-gho values and returns undefined when absent", () => {
    expect(
      extractGithubTokenFromOpencode({ anthropic: { key: "sk-ant-123" } }),
    ).toBeUndefined();
    expect(extractGithubTokenFromOpencode({})).toBeUndefined();
  });
});

describe("findOpencodeGithubToken", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tack-opencode-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads the token from the first existing, parseable file", () => {
    const path = join(dir, "auth.json");
    writeFileSync(path, JSON.stringify({ "github-copilot": { refresh: "gho_found" } }));
    expect(findOpencodeGithubToken([join(dir, "missing.json"), path])).toBe("gho_found");
  });

  test("returns undefined when no candidate file exists", () => {
    expect(findOpencodeGithubToken([join(dir, "nope.json")])).toBeUndefined();
  });

  test("tolerates a corrupt file and moves on", () => {
    const bad = join(dir, "bad.json");
    const good = join(dir, "good.json");
    writeFileSync(bad, "{ not json");
    writeFileSync(good, JSON.stringify({ copilot: { oauth: "gho_ok" } }));
    expect(findOpencodeGithubToken([bad, good])).toBe("gho_ok");
  });
});
