import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { Tokenizer } from "./types";

/**
 * BPE tokenizer backed by js-tiktoken.
 *
 * NOTE: js-tiktoken implements OpenAI's encodings (cl100k_base / o200k_base).
 * Counts for Anthropic and other providers are therefore APPROXIMATE. This is
 * acceptable because routing thresholds are coarse — we only need to tell a
 * ~200-token prompt from a ~5000-token one. When a provider-accurate tokenizer
 * is needed, implement the `Tokenizer` interface and swap it in; nothing else
 * changes.
 */
export class BpeTokenizer implements Tokenizer {
  private enc: Tiktoken;

  constructor(encoding: "cl100k_base" | "o200k_base" = "o200k_base") {
    this.enc = getEncoding(encoding);
  }

  count(text: string): number {
    if (text.length === 0) return 0;
    return this.enc.encode(text).length;
  }
}

/**
 * Zero-dependency fallback that estimates tokens from character count
 * (~4 chars/token). Useful for tests or environments where loading the BPE
 * tables is undesirable. Good enough for tier bucketing.
 */
export class ApproxTokenizer implements Tokenizer {
  count(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
