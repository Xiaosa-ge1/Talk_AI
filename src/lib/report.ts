import type { ChatMessage, DimensionKey, InterviewReport } from "./types";

/**
 * 报告生成逻辑（服务端 + 测试共用）：
 * 1. 组装 system prompt 要求 LLM 输出严格 JSON
 * 2. 调用 LlmClient（非流式一次性返回）
 * 3. 解析 JSON，失败自动重试一次，再失败返回错误（由 route 降级）
 */

export interface ReportLlm {
  complete(messages: Array<{ role: "system" | "user"; content: string }>): Promise<string>;
}

export const REPORT_SCHEMA_HINT =
  "请严格输出一个 JSON 对象（不要输出任何其他文字、不要用 markdown 代码块包裹），结构如下：" +
  '{ "summary": "一句话总评（鼓励优先，30-60 字）", ' +
  '"dimensions": [ { "key": "logic", "label": "表达逻辑", "score": 1-5, "comment": "一句话点评" }, ' +
  '{ "key": "depth", "label": "专业深度", "score": 1-5, "comment": "一句话点评" }, ' +
  '{ "key": "data", "label": "数据思维", "score": 1-5, "comment": "一句话点评" }, ' +
  '{ "key": "agility", "label": "应变能力", "score": 1-5, "comment": "一句话点评" } ], ' +
  '"improvements": [ { "question": "被问的问题", "yourAnswer": "你的回答（截断至 100 字）", ' +
  '"issue": "问题说明", "suggestion": "改进建议/参考思路" } ], ' +
  '"highlight": { "question": "问题", "quote": "你说得好的原话片段", "praise": "为什么好" } }';

export function buildReportSystemPrompt(resume: string, questionCount: number): string {
  const resumeBlock = resume.trim() ? "【候选人简历】\n" + resume.trim() : "（候选人未提供简历）";
  return (
    "你是一位资深的产品经理面试官兼教练。请为下面这场面试生成一份客观、鼓励优先的复盘报告。\n\n" +
    "【规则】\n" +
    "- improvements 最多 3 条，按「影响表达效果」从大到小排序；issue 要具体（语法/逻辑/数据不足/跑题等），suggestion 要可执行。\n" +
    "- dimensions 的 score 按 1-5 打分，4 个维度都要有；comment 一句话。\n" +
    "- highlight 挑一句真正说得好的，quote 用原话片段。\n" +
    "- 中文输出。\n\n" +
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

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  logic: "表达逻辑",
  depth: "专业深度",
  data: "数据思维",
  agility: "应变能力",
};

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
    return sanitizeReport(JSON.parse(jsonText));
  } catch {
    return null;
  }
}

/**
 * 生成报告：最多尝试 maxAttempts 次解析。
 * 每次重试会要求 LLM「只输出 JSON」。全部失败返回 null（route 据此降级为文本）。
 */
export async function generateReport(params: {
  resume: string;
  questionCount: number;
  messages: ChatMessage[];
  llm: ReportLlm;
  maxAttempts?: number;
}): Promise<InterviewReport | null> {
  const resume = params.resume;
  const questionCount = params.questionCount;
  const messages = params.messages;
  const llm = params.llm;
  const maxAttempts = params.maxAttempts ?? 2;
  const system = buildReportSystemPrompt(resume, questionCount);
  const user = buildReportUserPrompt(messages);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let raw: string;
    try {
      const userContent = attempt === 0 ? user : user + "\n\n上一次输出无法解析，请只输出纯 JSON。";
      raw = await llm.complete([
        { role: "system", content: system },
        { role: "user", content: userContent },
      ]);
    } catch {
      // 网络等异常：最后再抛给上层
      if (attempt === maxAttempts - 1) throw new Error("report llm call failed");
      continue;
    }
    const report = parseReport(raw);
    if (report) return report;
  }
  return null;
}
