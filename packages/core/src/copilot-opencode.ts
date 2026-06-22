import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Known locations of OpenCode's auth file across platforms/versions. Checked in
 * order; the first that exists and parses wins.
 */
export function opencodeAuthPaths(home: string = homedir()): string[] {
  const xdg = process.env.XDG_DATA_HOME;
  return [
    ...(xdg ? [join(xdg, "opencode", "auth.json")] : []),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
  ];
}

/**
 * Extract a GitHub OAuth (`gho_…`) token from an OpenCode Copilot auth entry.
 *
 * The shape has drifted across OpenCode versions — the Copilot entry has been
 * keyed as `github-copilot`, `copilot`, or `github`, and the token field as
 * `refresh`, `oauth`, `token`, or `access`. Rather than encode one shape, walk
 * the document and return the first `gho_`-prefixed string we find: that prefix
 * is unambiguous, so tolerance here is safe.
 */
export function extractGithubTokenFromOpencode(parsed: unknown): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | undefined => {
    if (typeof value === "string") {
      return value.startsWith("gho_") ? value : undefined;
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) return undefined;
      seen.add(value);
      for (const v of Object.values(value as Record<string, unknown>)) {
        const found = visit(v);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(parsed);
}

/**
 * Locate OpenCode's auth file and extract a reusable GitHub OAuth token, or
 * `undefined` if no file is found or no `gho_` token is present. Never throws on
 * a missing/corrupt file — reuse is a best-effort shortcut past the device flow.
 */
export function findOpencodeGithubToken(
  paths: string[] = opencodeAuthPaths(),
): string | undefined {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const token = extractGithubTokenFromOpencode(parsed);
      if (token) return token;
    } catch {
      // Unreadable or unparsable — move on to the next candidate path.
    }
  }
  return undefined;
}
