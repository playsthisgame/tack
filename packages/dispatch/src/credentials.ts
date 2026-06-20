import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultRegistry, parseModelString, type ProviderRegistry } from "./providers";

/**
 * A place to read/write provider API keys, kept DISTINCT from the scoring config
 * (`core/src/config.ts`). Keys are secrets; routing config is shareable — they
 * must never live in the same file.
 */
export interface SecretsStore {
  get(provider: string): string | undefined;
  set(provider: string, key: string): void;
}

/** Default secrets path: `$XDG_CONFIG_HOME/tack/credentials` or `~/.config/tack/credentials`. */
export function defaultSecretsPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "tack", "credentials");
}

/**
 * File-backed secrets store. Persists a flat `{ provider: key }` JSON document
 * with 0600 permissions. A missing or unreadable file is treated as empty.
 */
export class FileSecretsStore implements SecretsStore {
  constructor(private readonly path: string = defaultSecretsPath()) {}

  private read(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  }

  get(provider: string): string | undefined {
    return this.read()[provider];
  }

  set(provider: string, key: string): void {
    const data = this.read();
    data[provider] = key;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

/** The environment variable a provider's key is read from, per the registry. */
export function envVarForProvider(
  provider: string,
  registry: ProviderRegistry = defaultRegistry,
): string | undefined {
  return registry[provider]?.envVar;
}

export interface ResolveKeyOptions {
  env?: Record<string, string | undefined>;
  store?: SecretsStore;
  registry?: ProviderRegistry;
}

/**
 * Resolve a provider's API key from layered sources: the environment (incl.
 * `.env`) first, then the secrets store. Returns undefined if neither has it.
 * Never logs or echoes the value.
 */
export function resolveKey(provider: string, options: ResolveKeyOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const registry: ProviderRegistry = options.registry ?? defaultRegistry;

  const envVar = registry[provider]?.envVar;
  if (envVar && env[envVar]) return env[envVar];

  return options.store?.get(provider);
}

/**
 * The distinct providers referenced by a tier→model map, so a UI only asks for
 * the keys actually in use. Order follows first appearance.
 */
export function requiredProviders(tierModels: Record<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of Object.values(tierModels)) {
    const { provider } = parseModelString(model);
    if (!seen.has(provider)) {
      seen.add(provider);
      out.push(provider);
    }
  }
  return out;
}
