import type { ChatMessage, DimensionKey, DimensionScore, ScoreScale } from "./types";
import {
  DEFAULT_SCORE_SCALE,
  DIMENSION_LABELS,
  buildRubricPromptText,
  defaultScoreOf,
  scoreFloor,
} from "./rubric";

/**
 * 「只打分」轻量逻辑 —— 供评测（evaluate-v2）与可能的快速反馈场景使用。
 *
 * 与 report.ts 的区别：这里只让 LLM 输出 4 个维度的分数 + 简短 evidence，
 * 不生成 summary / improvements / highlight 等完整报告字段，
 * 因此单次调用 token 更省、延迟更低，适合「只要四维分数」的批量评测。
 *
 * 复用：评分标准（rubric）与 report 完全一致，保证评测结论能迁移到真实报告。
 * 维度类型复用 types.ts 的 DimensionScore（含可选 evidence），不重复定义。
 */

export interface ScoreResult {
  dimensions: DimensionScore[];
}

const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as DimensionKey[];

/** 简历截断（与 report.ts 同阈值，控制 token） */
const RESUME_MAX = 2000;
function truncateResume(resume: string): string {
  return resume.length > RESUME_MAX ? resume.slice(0, RESUME_MAX) + "…" : resume;
}

export function buildScoreSystemPrompt(
  resume: string,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): string {
  const resumeBlock = resume.trim()
    ? "【候选人简历】\n" + truncateResume(resume.trim())
    : "（候选人未提供简历）";
  const sample = defaultScoreOf(scale);
  const dimExamples = DIMENSION_KEYS.map((k, i) => {
    const comma = i < DIMENSION_KEYS.length - 1 ? "," : "";
    return `    { "key": "${k}", "score": ${sample}, "evidence": "引用对话原句" }${comma}`;
  }).join("\n");
  return (
    "你是资深产品经理面试官。请只对下面这场面试的四维表现打分，不要写点评、建议或总评。\n\n" +
    "【输出格式 - 必须严格按此 JSON，字段名一个都不能改，不要加多余字段】\n" +
    "{\n" +
    '  "dimensions": [\n' +
    dimExamples +
    "\n  ]\n" +
    "}\n\n" +
    buildRubricPromptText(scale) +
    "\n\n" +
    resumeBlock
  );
}

export function buildScoreUserPrompt(messages: ChatMessage[]): string {
  const transcript = messages
    .map((m) => (m.role === "assistant" ? "面试官" : "候选人") + "：" + m.content)
    .join("\n");
  return "【面试实录】\n" + transcript + "\n\n请只输出四维分数 JSON。";
}

/** 从 LLM 输出提取 JSON（与 report.ts extractJson 同策略） */
function extractJson(raw: string): string | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function toScore(v: unknown, scale: ScoreScale): number {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return defaultScoreOf(scale);
  return Math.min(scale, Math.max(scoreFloor(scale), Math.round(n)));
}

/** 解析 LLM 输出为四维分数（容忍数组/对象两种形态，字段缺失兜底），失败返回 null */
export function parseScore(
  raw: string,
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): ScoreResult | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const dimsRaw = obj?.dimensions ?? obj; // 可能直接是 {logic:{...},...} 或 {dimensions:[...]}

  const list: DimensionScore[] = [];
  const seen = new Set<DimensionKey>();
  const push = (key: DimensionKey, dim: Record<string, unknown>) => {
    if (seen.has(key)) return;
    seen.add(key);
    list.push({
      key,
      label: DIMENSION_LABELS[key],
      score: toScore(dim.score, scale),
      comment: "",
      evidence: typeof dim.evidence === "string" ? dim.evidence.slice(0, 200) : "",
    });
  };

  if (Array.isArray(dimsRaw)) {
    for (const d of dimsRaw) {
      if (!d || typeof d !== "object") continue;
      const dim = d as Record<string, unknown>;
      const key = dim.key as DimensionKey | undefined;
      if (key && DIMENSION_LABELS[key]) push(key, dim);
    }
  } else if (dimsRaw && typeof dimsRaw === "object") {
    for (const [key, v] of Object.entries(dimsRaw as Record<string, unknown>)) {
      if (!DIMENSION_LABELS[key as DimensionKey]) continue;
      if (!v || typeof v !== "object") continue;
      push(key as DimensionKey, v as Record<string, unknown>);
    }
  }

  if (list.length === 0) return null;
  return { dimensions: list };
}
