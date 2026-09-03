import { parseResumeFile, isMeaningfulText, normalizeText } from "./resume-file";
import type { ParseResumeResult } from "./types";

export { parseResumeFile, isMeaningfulText, normalizeText };
export type { ParseResumeResult };

/**
 * 简历解析的统一入口（浏览器/服务端共用）。
 * - 文件解析（PDF/DOCX）在服务端进行（resume-file）
 * - 文本解析在浏览器端进行（粘贴文本场景）
 * 文本归一化/有效性判定实现在 resume-file（提取后处理），此处复用并透传。
 *
 * 设计原则：解析失败（扫描版 PDF、损坏文件）必须给出可识别的错误，
 * 由上层引导用户「转粘贴文本」降级，绝不静默返回空文本。
 */

/**
 * 解析粘贴的纯文本简历。
 * @param raw 用户粘贴的原文
 * @returns 归一化后的结果；空输入返回 source=text 但 text=""（由调用方判断）
 */
export function parseResumeText(raw: string): ParseResumeResult {
  const text = normalizeText(raw);
  return { text, source: "text", charCount: text.length };
}
