/**
 * Signal detectors. Each is a small, independently testable pure function that
 * inspects prompt text and reports whether a pattern is present. Keeping these
 * separate from the scorer makes them easy to unit test and easy to extend.
 */

/** Heuristic stack-trace detection across common languages. */
export function hasStackTrace(text: string): boolean {
  const patterns = [
    /^\s*at\s+.+\(.+:\d+:\d+\)/m, // JS/TS:  at fn (file:line:col)
    /Traceback \(most recent call last\)/, // Python
    /^\s*File ".+", line \d+/m, // Python frame
    /\b[\w.]+Exception\b/, // Java/.NET exceptions
    /panic:\s/, // Go
    /thread '.*' panicked at/, // Rust
  ];
  return patterns.some((p) => p.test(text));
}

/** Detects a unified diff or a sizable patch block. */
export function hasLargeDiff(text: string): boolean {
  const diffHeader = /^(diff --git|---\s|\+\+\+\s|@@\s)/m;
  if (!diffHeader.test(text)) return false;
  const changedLines = (text.match(/^[+-]/gm) ?? []).length;
  return changedLines >= 10;
}

/** Detects references to multiple files (paths with extensions). */
export function hasMultipleFiles(text: string): boolean {
  const fileRefs = text.match(/[\w./-]+\.\w{1,5}\b/g) ?? [];
  const unique = new Set(fileRefs.map((f) => f.toLowerCase()));
  return unique.size >= 3;
}

/** Detects fenced code blocks. */
export function hasCodeBlock(text: string): boolean {
  return /```[\s\S]*?```/.test(text) || /^ {4}\S/m.test(text);
}

/** Case-insensitive whole-word match. */
export function containsWord(text: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return re.test(text);
}
