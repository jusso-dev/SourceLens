/** Document text extractors. PDF/TXT/MD now; DOCX optional via mammoth. */

import { env } from "@/lib/env";

export type ExtractedFileType = "pdf" | "txt" | "md" | "docx";

export interface ExtractResult {
  text: string;
  fileType: ExtractedFileType;
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Centralised file-type derivation. Used by both the extractor and the
 *  upload route so the two cannot disagree about how a `.md` file is
 *  classified. Returns `null` when the input doesn't match any allowed type. */
export function detectFileType(filename: string, mimeType: string): ExtractedFileType | null {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType === DOCX_MIME || lower.endsWith(".docx")) return "docx";
  if (mimeType === "text/markdown" || lower.endsWith(".md") || lower.endsWith(".markdown"))
    return "md";
  if (mimeType === "text/plain" || lower.endsWith(".txt")) return "txt";
  return null;
}

export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractResult> {
  const fileType = detectFileType(filename, mimeType) ?? "txt";

  let raw: string;
  if (fileType === "pdf") {
    // Avoid pdf-parse's broken index.js (it eagerly reads a test fixture). The
    // sub-module export does the same work without the debug branch.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const out = await pdfParse(buffer);
    raw = out.text;
  } else if (fileType === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    raw = value;
  } else {
    // TXT or MD: native UTF-8 decode. Strip a leading BOM if present so
    // chunkers and tokenisers don't see a spurious first character.
    raw = buffer.toString("utf8").replace(/^﻿/, "");
  }

  const text = capLength(normalise(raw), env.maxExtractedChars);
  return { text, fileType };
}

function normalise(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Bound on extracted text. Some PDFs decompress into hundreds of MB of text;
 *  beyond this we'd OOM the worker before we even hit the chunker. */
function capLength(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}
