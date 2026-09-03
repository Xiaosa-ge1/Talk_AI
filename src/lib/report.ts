import type { ChatMessage, DimensionKey, InterviewReport, ScoreScale } from "./types";
import {
  DEFAULT_SCORE_SCALE,
  DIMENSION_LABELS,
  buildRubricPromptText,
  defaultScoreOf,
  scoreFloor,
} from "./rubric";

/**
 * 报告生成逻辑（服务端 API route 使用）：
 * 1. 组装 system prompt 要求 LLM 输出严格 JSON（简历截断控制 token）
 * 2. 评分标准来自 rubric.ts（每维锚点 + 证据引用），让分数可解释可核验
 * 3. 解析 LLM 输出为结构化报告（容错：围栏/杂音/缺字段/score 越界）
 * 注意：LLM 调用与重试逻辑在 /api/report route 内（SSE 流式），本文件只含纯函数。
 *
 * 分制（scale）：5 分制为产品默认；百分制仅用于评测的分制对比实验，
 * 影响 prompt 里的锚点分值与 score 收敛区间，不影响报告结构。
 */

/** 简历放进 prompt 前的最大长度（控制每轮/报告调用的 token） */
export const RESUME_PROMPT_MAX_CHARS = 2000;

function truncateResume(resume: string, maxChars = RESUME_PROMPT_MAX_CHARS): string {
  return resume.length > maxChars ? resume.slice(0, maxChars) + "…" : resume;
}

/** 四个维度的固定顺序（prompt 示例与兜底维度共用） */
const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as DimensionKey[];

export function buildReportSystemPrompt(
  resume: string,
  questionCount: number,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): string {
  const resumeBlock = resume.trim()
    ? "【候选人简历】\n" + truncateResume(resume.trim())
    : "（候选人未提供简历）";
  const sampleScore = defaultScoreOf(scale);
  const dimExamples = DIMENSION_KEYS.map((k, i) => {
    const evidenceHint = i === 0 ? "引用候选人对话原句作为打分依据" : "引用候选人对话原句";
    const comma = i < DIMENSION_KEYS.length - 1 ? "," : "";
    return (
      `    { "key": "${k}", "score": ${sampleScore}, ` +
      `"comment": "一句话点评", "evidence": "${evidenceHint}" }${comma}`
    );
  }).join("\n");
  return (
    "你是一位资深的产品经理面试官兼教练。请为下面这场面试生成一份客观、鼓励优先的复盘报告。\n\n" +
    "【规则】\n" +
    "- improvements 最多 3 条，按「影响表达效果」从大到小排序；issue 要具体（语法/逻辑/数据不足/跑题等），suggestion 要可执行。\n" +
    `- dimensions 必须包含且仅包含 4 个维度：logic/depth/data/agility，score 按下方评分标准打分（本次为 ${scale} 分制），每个维度都必须给 evidence（引用对话原句）。\n` +
    "- highlight 挑一句真正说得好的，quote 用原话片段。\n" +
    "- 中文输出。\n\n" +
    "【输出格式 - 必须严格按此 JSON 结构，字段名一个都不能改，不要加多余顶层字段】\n" +
    "{\n" +
    '  "summary": "一句话总评",\n' +
    '  "dimensions": [\n' +
    dimExamples +
    "\n  ],\n" +
    '  "improvements": [\n' +
    '    { "question": "对应面试题", "yourAnswer": "你的回答片段", "issue": "具体问题", "suggestion": "可执行建议" }\n' +
    "  ],\n" +
    '  "highlight": { "question": "对应面试题", "quote": "说得好的原话", "praise": "为什么好" }\n' +
    "}\n\n" +
    buildRubricPromptText(scale) +
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

/** 从多个候选键取第一个非空字符串（容忍 LLM 的字段名漂移，如 summary/overall） */
function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 把 score 收敛到当前分制的合法区间（容忍 "4" / 4 / "4分" / 越界等写法） */
function toScore(v: unknown, scale: ScoreScale = DEFAULT_SCORE_SCALE): number {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return defaultScoreOf(scale);
  return Math.min(scale, Math.max(scoreFloor(scale), Math.round(n)));
}

/**
 * 把 dimensions 归一化成统一数组。
 * LLM 输出不稳定，出现过两种形态：
 *   1. 数组：[{key:"logic", score, comment, evidence}, ...]
 *   2. 对象：{logic: {score, comment?, evidence?}, depth: {...}, ...}
 */
function normalizeDimensions(
  raw: unknown,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): InterviewReport["dimensions"] {
  const list: InterviewReport["dimensions"] = [];
  const seen = new Set<DimensionKey>();
  const push = (key: DimensionKey, dim: Record<string, unknown>) => {
    if (seen.has(key)) return; // 去重，保留第一份
    seen.add(key);
    list.push({
      key,
      label: DIMENSION_LABELS[key],
      score: toScore(dim.score, scale),
      comment: typeof dim.comment === "string" ? dim.comment : "",
      evidence: typeof dim.evidence === "string" ? dim.evidence.slice(0, 200) : "",
    });
  };
  if (Array.isArray(raw)) {
    for (const d of raw) {
      if (!d || typeof d !== "object") continue;
      const dim = d as Record<string, unknown>;
      const key = dim.key as DimensionKey | undefined;
      if (!key || !DIMENSION_LABELS[key]) continue;
      push(key, dim);
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!DIMENSION_LABELS[key as DimensionKey]) continue; // 只收合法维度键
      if (!v || typeof v !== "object") continue;
      push(key as DimensionKey, v as Record<string, unknown>);
    }
  }
  return list;
}

/** 归一化 highlight（LLM 出现过对象 {quote,reason|praise|comment}、数组、纯字符串三种形态） */
function normalizeHighlight(raw: unknown): InterviewReport["highlight"] {
  const obj: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    Object.assign(obj, raw);
  } else if (Array.isArray(raw) && raw[0] && typeof raw[0] === "object") {
    Object.assign(obj, raw[0]);
  } else if (typeof raw === "string") {
    obj.praise = raw; // 退化为纯夸奖文本
  }
  return {
    question: pickString(obj, ["question"]),
    quote: pickString(obj, ["quote"]),
    praise: pickString(obj, ["praise", "reason", "comment"]),
  };
}

/** 校验并规范化报告对象（容忍缺字段/score 越界/schema 漂移） */
export function sanitizeReport(
  raw: unknown,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): InterviewReport | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // LLM 偶发把 summary 写成 overall
  const summary = pickString(obj, ["summary", "overall"]);
  if (!summary) return null;

  const dims = normalizeDimensions(obj.dimensions, scale);

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

  const highlight = normalizeHighlight(obj.highlight ?? obj.highlights);

  return {
    summary: summary,
    dimensions: dims.length > 0 ? dims : defaultDimensions(scale),
    improvements: improvements.length > 0 ? improvements : [],
    highlight: highlight,
    createdAt: Date.now(),
  };
}

function defaultDimensions(scale: ScoreScale = DEFAULT_SCORE_SCALE): InterviewReport["dimensions"] {
  return DIMENSION_KEYS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    score: defaultScoreOf(scale),
    comment: "",
  }));
}

/** 解析并校验 LLM 输出，失败返回 null */
export function parseReport(
  raw: string,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): InterviewReport | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    // LLM 输出结构不稳定：可能平铺 {summary...}，也可能包一层 {"report": {...}}
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const topHasSummary = pickString(obj, ["summary", "overall"]) !== "";
      if (!topHasSummary && obj.report && typeof obj.report === "object") {
        return sanitizeReport(obj.report, scale);
      }
    }
    return sanitizeReport(parsed, scale);
  } catch {
    return null;
  }
}
