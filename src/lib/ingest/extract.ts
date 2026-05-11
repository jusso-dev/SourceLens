/** Document text extractors. PDF/TXT/MD now; DOCX optional via mammoth. */

export type ExtractResult = { text: string; fileType: "pdf" | "txt" | "md" | "docx" };

export async function extractText(buffer: Buffer, filename: string, mimeType: string): Promise<ExtractResult> {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    // Avoid pdf-parse's broken index.js (it eagerly reads a test fixture). The
    // sub-module export does the same work without the debug branch.
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const out = await pdfParse(buffer);
    return { text: normalise(out.text), fileType: "pdf" };
  }
  if (lower.endsWith(".md") || mimeType === "text/markdown") {
    return { text: normalise(buffer.toString("utf8")), fileType: "md" };
  }
  if (lower.endsWith(".docx") || mimeType.includes("officedocument")) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: normalise(value), fileType: "docx" };
  }
  // Default: treat as plain text.
  return { text: normalise(buffer.toString("utf8")), fileType: "txt" };
}

function normalise(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
