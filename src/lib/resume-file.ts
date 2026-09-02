import type { ParseResumeResult } from "./types";

/**
 * 简历文件解析（服务端专用）。
 * - PDF：pdfjs-dist（纯 ESM，动态 import）
 * - DOCX：mammoth
 * 文件超过 MAX_FILE_BYTES 或解析后无有效文本（扫描版）时抛错，由 API 层降级提示。
 * 只提取文本，不保留文件本身（符合「文件不入库」红线）。
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export class ResumeParseError extends Error {
  code: "too_large" | "unsupported_type" | "parse_failed" | "no_text";
  constructor(code: ResumeParseError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ResumeParseError";
  }
}

function isMeaningful(text: string): boolean {
  return text.replace(/\s/g, "").trim().length >= 10;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function parsePdf(data: Uint8Array): Promise<string> {
  // pdfjs-dist v6 是纯 ESM 且需要 Node 端字体/路径配置，只能动态 import
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const standardFontDataUrl = pathToFileURL(
    resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/") + "/"
  ).href;

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl,
  });
  const doc = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // pdfjs 的 items 是 TextItem | TextMarkedContent；只取带 str 的文本项。
      // 运行时只有 TextItem 有 str，这里仅做结构判断，不依赖 pdfjs 类型细节。
      const items = content.items as unknown as Array<{ str?: unknown }>;
      const line = items
        .filter((item) => typeof item.str === "string")
        .map((item) => item.str as string)
        .join(" ");
      pageTexts.push(line);
    }
    return normalize(pageTexts.join("\n"));
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

async function parseDocx(buffer: ArrayBuffer): Promise<string> {
  // mammoth 是 CJS，通过 createRequire 引入以避免 ESM interop 问题
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return normalize(result.value);
}

function bytesToUint8(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  if (buffer instanceof Uint8Array) return buffer;
  return new Uint8Array(buffer);
}

/**
 * 解析上传的简历文件。
 * @throws ResumeParseError —— 上层据此给用户降级提示
 */
export async function parseResumeFile(
  file: File | { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
): Promise<ParseResumeResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ResumeParseError("too_large", "文件超过 20MB 限制");
  }

  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const buffer = await file.arrayBuffer();

  let text: string;
  if (ext === "pdf") {
    text = await parsePdf(bytesToUint8(buffer));
  } else if (ext === "docx" || ext === "doc") {
    text = await parseDocx(buffer);
  } else {
    throw new ResumeParseError("unsupported_type", "仅支持 PDF 或 Word 文件");
  }

  if (!isMeaningful(text)) {
    throw new ResumeParseError(
      "no_text",
      "未能从文件中提取到文本（可能是扫描版 PDF），请改用粘贴文本"
    );
  }

  return { text, source: ext === "pdf" ? "pdf" : "docx", charCount: text.length };
}
