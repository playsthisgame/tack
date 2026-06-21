import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { tool } from "ai";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const BASH_TIMEOUT_MS = 30_000;
const OUTPUT_CAP_BYTES = 50 * 1024;

function cap(output: string): string {
  if (Buffer.byteLength(output) <= OUTPUT_CAP_BYTES) return output;
  const truncated = Buffer.from(output).slice(0, OUTPUT_CAP_BYTES).toString("utf8");
  return `${truncated}\n[output truncated at 50 KB]`;
}

export const defaultToolRegistry = {
  read_file: tool({
    description: "Read the contents of a file at the given path.",
    parameters: z.object({
      path: z.string().describe("Path to the file to read"),
    }),
    execute: async ({ path }) => {
      try {
        return readFileSync(path, "utf8");
      } catch (err) {
        return `error: ${(err as NodeJS.ErrnoException).message}`;
      }
    },
  }),

  write_file: tool({
    description: "Write content to a file, creating it (and any missing parent directories) if needed.",
    parameters: z.object({
      path: z.string().describe("Path to write"),
      content: z.string().describe("Content to write"),
    }),
    execute: async ({ path, content }) => {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, "utf8");
        return `wrote ${content.length} chars to ${path}`;
      } catch (err) {
        return `error: ${(err as NodeJS.ErrnoException).message}`;
      }
    },
  }),

  bash: tool({
    description: "Run a shell command. Returns combined stdout and stderr. Timeout: 30 s. Output cap: 50 KB.",
    parameters: z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    execute: async ({ command }) => {
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
          timeout: BASH_TIMEOUT_MS,
          maxBuffer: OUTPUT_CAP_BYTES * 2,
        });
        return cap((stdout + stderr).trim());
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
        if (e.killed) return `error: command timed out after ${BASH_TIMEOUT_MS / 1000} s`;
        const output = ((e.stdout ?? "") + (e.stderr ?? "")).trim();
        return output ? cap(output) : `error: ${e.message}`;
      }
    },
  }),
};

export type ToolRegistry = typeof defaultToolRegistry;
