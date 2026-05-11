/** Prompt-injection guard for retrieved chunks.
 *
 *  Each retrieved chunk is treated as untrusted data. This module:
 *    1. Strips zero-width / bidi-override characters that hide instructions.
 *    2. Detects high-risk patterns and tags the chunk with their names so the
 *       caller can display a warning and persist the flags.
 *    3. Optionally redacts (strip mode) or excludes (block mode) the chunk
 *       before it reaches the LLM.
 *  The actual prompt also wraps each chunk in a delimited block with an
 *  explicit "untrusted" attribute (see formatContexts in providers/ollama.ts).
 */

export type InjectionMode = "warn" | "strip" | "block";

export interface SanitiseResult {
  /** Cleaned text to send to the LLM. In `block` mode this is empty if any
   *  high-risk flag fired. */
  text: string;
  /** Names of patterns that matched. Empty array = clean. */
  flags: string[];
  /** True iff `block` mode triggered and the chunk should be excluded from
   *  the LLM context (still listed in Sources for transparency). */
  blocked: boolean;
}

interface Detector {
  name: string;
  test: RegExp;
  /** When `true`, the detector's matches are removed in `strip` mode. */
  redactable: boolean;
}

const DETECTORS: Detector[] = [
  {
    name: "ignore_previous",
    test: /\b(ignore|disregard|forget)\s+(?:all\s+|the\s+|any\s+)?(previous|prior|above|preceding|earlier)\s+(instructions?|rules?|prompts?|messages?|content|context|directives?)\b/i,
    redactable: true,
  },
  {
    name: "role_directive",
    test: /(?:^|\n)\s*(system|admin|administrator|developer|user|assistant)\s*:\s*/i,
    redactable: true,
  },
  {
    name: "tag_break",
    test: /<\/?\s*(context|chunk|document|system|instructions|untrusted\s+source)\b/i,
    redactable: true,
  },
  {
    name: "boundary_marker",
    test: /\b(BEGIN|END)\s+(ADMIN|SYSTEM|INSTRUCTIONS|PROMPT)\b/i,
    redactable: true,
  },
  {
    name: "long_base64",
    // 96+ char run looks like a hidden encoded payload. Not stripped (legit data
    // — embedded PNG, etc. — can look like this); we only flag.
    test: /[A-Za-z0-9+/]{96,}={0,2}/,
    redactable: false,
  },
];

// Zero-width / bidi-override / invisible-formatting characters. These can hide
// instructions inside otherwise-innocent looking text; strip them always.
// Range covers ZWSP/ZWNJ/ZWJ (U+200B-U+200D), LRM/RLM (U+200E-U+200F),
// LRE/RLE/PDF/LRO/RLO (U+202A-U+202E), word-joiner/invisible-times etc.
// (U+2060-U+2064), and BOM (U+FEFF).
const ZERO_WIDTH_RX = /[​-‏‪-‮⁠-⁤﻿]/g;

/** Always-on baseline: strip hidden Unicode and look for risk patterns. */
function detect(text: string): { stripped: string; flags: string[] } {
  const flags: string[] = [];
  if (ZERO_WIDTH_RX.test(text)) flags.push("hidden_unicode");
  ZERO_WIDTH_RX.lastIndex = 0;
  const stripped = text.replace(ZERO_WIDTH_RX, "");

  for (const d of DETECTORS) {
    if (d.test.test(stripped)) flags.push(d.name);
  }
  return { stripped, flags };
}

export function detectInjection(text: string): { flags: string[] } {
  return { flags: detect(text).flags };
}

export function sanitiseChunkForPrompt(
  text: string,
  mode: InjectionMode = readMode(),
): SanitiseResult {
  const { stripped, flags } = detect(text);

  if (flags.length === 0) return { text: stripped, flags, blocked: false };

  if (mode === "block") {
    return { text: "", flags, blocked: true };
  }
  if (mode === "strip") {
    let redacted = stripped;
    for (const d of DETECTORS) {
      if (!d.redactable) continue;
      redacted = redacted.replace(new RegExp(d.test.source, "gi"), "[REDACTED]");
    }
    return { text: redacted, flags, blocked: false };
  }
  // warn: emit flags, do not modify content beyond zero-width strip
  return { text: stripped, flags, blocked: false };
}

export function readMode(): InjectionMode {
  const raw = (process.env.RAG_INJECTION_MODE ?? "warn").toLowerCase();
  if (raw === "strip" || raw === "block" || raw === "warn") return raw;
  return "warn";
}
