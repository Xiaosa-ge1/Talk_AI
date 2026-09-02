import { parseResumeFile } from "./resume-file";
import type { ParseResumeResult } from "./types";

export type { ParseResumeResult };

/**
 * 简历解析的统一入口（浏览器/服务端共用）。
 * - 文件解析（PDF/DOCX）在服务端进行（resume-file）
 * - 文本解析在浏览器端进行（粘贴文本场景）
 *
 * 设计原则：解析失败（扫描版 PDF、损坏文件）必须给出可识别的错误，
 * 由上层引导用户「转粘贴文本」降级，绝不静默返回空文本。
 */

/** 提取到的文本是否是「空/无意义」——用于判定扫描版等异常 */
export function isMeaningfulText(text: string): boolean {
  const cleaned = text.replace(/\s/g, "").trim();
  return cleaned.length >= 10;
}

/** 归一化换行：合并多余空行，保证每行有意义的文本可被 LLM 理解 */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 解析粘贴的纯文本简历。
 * @param raw 用户粘贴的原文
 * @returns 归一化后的结果；空输入返回 source=text 但 text=""（由调用方判断）
 */
export function parseResumeText(raw: string): ParseResumeResult {
  const text = normalizeText(raw);
  return { text, source: "text", charCount: text.length };
}

export { parseResumeFile };
