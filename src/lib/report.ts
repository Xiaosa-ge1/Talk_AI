import type { ChatMessage, DimensionKey, InterviewReport } from "./types";
import { DIMENSION_LABELS, buildRubricPromptText } from "./rubric";

/**
 * 报告生成逻辑（服务端 API route 使用）：
 * 1. 组装 system prompt 要求 LLM 输出严格 JSON（简历截断控制 token）
 * 2. 评分标准来自 rubric.ts（每维锚点 + 证据引用），让分数可解释可核验
 * 3. 解析 LLM 输出为结构化报告（容错：围栏/杂音/缺字段/score 越界）
 * 注意：LLM 调用与重试逻辑在 /api/report route 内（SSE 流式），本文件只含纯函数。
 */

/** 简历放进 prompt 前的最大长度（控制每轮/报告调用的 token） */
export const RESUME_PROMPT_MAX_CHARS = 2000;

function truncateResume(resume: string, maxChars = RESUME_PROMPT_MAX_CHARS): string {
  return resume.length > maxChars ? resume.slice(0, maxChars) + "…" : resume;
}

export function buildReportSystemPrompt(resume: string, questionCount: number): string {
  const resumeBlock = resume.trim()
    ? "【候选人简历】\n" + truncateResume(resume.trim())
    : "（候选人未提供简历）";
  return (
    "你是一位资深的产品经理面试官兼教练。请为下面这场面试生成一份客观、鼓励优先的复盘报告。\n\n" +
    "【规则】\n" +
    "- improvements 最多 3 条，按「影响表达效果」从大到小排序；issue 要具体（语法/逻辑/数据不足/跑题等），suggestion 要可执行。\n" +
    "- dimensions 必须包含且仅包含 4 个维度：logic/depth/data/agility，score 按下方评分标准打分，每个维度都必须给 evidence（引用对话原句）。\n" +
    "- highlight 挑一句真正说得好的，quote 用原话片段。\n" +
    "- 中文输出。\n\n" +
    buildRubricPromptText() +
    "\n\n" +
    resumeBlock +
    "\n\n目标题量：" +
    questionCount +
    " 题。"
  );
}

export function buildReportUserPrompt(messages: ChatMessage[]): string {
  const transcript = messages
    .map(function (m: ChatMessage): string {
      const speaker = m.role === "assistant" ? "面试官" : "候选人";
      return speaker + "：" + m.content;
    })
    .join("\n");
  return "【面试实录】\n" + transcript + "\n\n请基于以上实录生成报告 JSON。";
}

/** 从 LLM 输出中提取 JSON（容忍被 markdown 代码块包裹或前后有杂音） */
export function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  // 去掉 ```json ... ``` 包裹
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/;
  const fenceMatch = trimmed.match(fenceRe);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  // 找第一个 { 到最后一个 } 之间的内容
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** 校验并规范化报告对象（容忍缺字段/score 越界） */
export function sanitizeReport(raw: unknown): InterviewReport | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.summary !== "string" || !obj.summary.trim()) return null;

  const dims = Array.isArray(obj.dimensions)
    ? (obj.dimensions as unknown[])
        .map(function (d) {
          if (!d || typeof d !== "object") return null;
          const dim = d as Record<string, unknown>;
          const key = dim.key as DimensionKey | undefined;
          if (!key || !DIMENSION_LABELS[key]) return null;
          const num = Number(dim.score);
          return {
            key: key,
            label: DIMENSION_LABELS[key],
            score: Number.isFinite(num) ? Math.min(5, Math.max(1, Math.round(num))) : 3,
            comment: typeof dim.comment === "string" ? dim.comment : "",
            evidence: typeof dim.evidence === "string" ? dim.evidence.slice(0, 200) : "",
          };
        })
        .filter(function (x) {
          return x !== null;
        })
    : [];

  const improvements = Array.isArray(obj.improvements)
    ? (obj.improvements as unknown[])
        .filter(function (x): x is Record<string, unknown> {
          return (
            !!x && typeof x === "object" && typeof (x as Record<string, unknown>).issue === "string"
          );
        })
        .map(function (x) {
          return {
            question: typeof x.question === "string" ? x.question : "",
            yourAnswer: typeof x.yourAnswer === "string" ? x.yourAnswer.slice(0, 150) : "",
            issue: x.issue as string,
            suggestion: typeof x.suggestion === "string" ? x.suggestion : "",
          };
        })
        .slice(0, 3)
    : [];

  const hl = (obj.highlight ?? {}) as Record<string, unknown>;
  const highlight = {
    question: typeof hl.question === "string" ? hl.question : "",
    quote: typeof hl.quote === "string" ? hl.quote : "",
    praise: typeof hl.praise === "string" ? hl.praise : "",
  };

  return {
    summary: obj.summary.trim(),
    dimensions: dims.length > 0 ? dims : defaultDimensions(),
    improvements: improvements.length > 0 ? improvements : [],
    highlight: highlight,
    createdAt: Date.now(),
  };
}

function defaultDimensions(): InterviewReport["dimensions"] {
  return [
    { key: "logic", label: DIMENSION_LABELS.logic, score: 3, comment: "" },
    { key: "depth", label: DIMENSION_LABELS.depth, score: 3, comment: "" },
    { key: "data", label: DIMENSION_LABELS.data, score: 3, comment: "" },
    { key: "agility", label: DIMENSION_LABELS.agility, score: 3, comment: "" },
  ];
}

/** 解析并校验 LLM 输出，失败返回 null */
export function parseReport(raw: string): InterviewReport | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    // LLM 输出结构不稳定：可能平铺 {summary...}，也可能包一层 {"report": {...}}
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.summary !== "string" && obj.report && typeof obj.report === "object") {
        return sanitizeReport(obj.report);
      }
    }
    return sanitizeReport(parsed);
  } catch {
    return null;
  }
}
