import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const exec = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await exec(cmd, args, { cwd });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function fileTree(cwd: string): Promise<string> {
  // Prefer git-aware listing; fall back to find for non-repos.
  const gitFiles = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], cwd);
  if (gitFiles !== null) {
    // Flatten to 2-level paths and deduplicate directories.
    const entries = new Set<string>();
    for (const line of gitFiles.split("\n").filter(Boolean)) {
      const parts = line.split("/");
      entries.add(parts.length === 1 ? parts[0] : `${parts[0]}/${parts[1]}${parts.length > 2 ? "/…" : ""}`);
    }
    return [...entries].sort().join("\n");
  }
  // Fallback: find 2 levels, exclude hidden dirs.
  const found = await run("find", [".", "-maxdepth", "2", "-not", "-path", "*/.*"], cwd);
  return found ?? "(unable to list files)";
}

async function gitContext(cwd: string): Promise<string | null> {
  const branch = await run("git", ["branch", "--show-current"], cwd);
  if (branch === null) return null;
  const status = await run("git", ["status", "--short"], cwd);
  const statusLine = status ? `\n${status}` : " (clean)";
  return `branch: ${branch}${statusLine}`;
}

export async function buildSystemPrompt(cwd: string = process.cwd()): Promise<string> {
  const [tree, git] = await Promise.all([fileTree(cwd), gitContext(cwd)]);

  const lines: string[] = [
    "You are an expert coding assistant with access to tools for reading files, writing files, and running shell commands.",
    "",
    `Working directory: ${cwd}`,
    "",
    "Project files (snapshot at session start):",
    tree,
  ];

  if (git) {
    lines.push("", "Git context:", git);
  }

  lines.push(
    "",
    "Use tools to inspect the codebase before answering questions about it.",
    "When writing or editing files, prefer making minimal focused changes.",
  );

  return lines.join("\n");
}
