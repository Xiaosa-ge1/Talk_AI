import type { DimensionKey, ScoreScale } from "./types";

/**
 * 报告评分标准（rubric）—— 让 LLM 打分有依据、可解释、可复验。
 *
 * 设计原则：
 * 1. 每维给低/中/高三档「行为锚点」，LLM 不再是"凭感觉打 4 分"，
 *    而是对照行为描述判断"更接近哪一档"。锚点分数按分制换算
 *    （5 分制 1/3/5，百分制 20/60/100），行为描述本身与分制无关。
 * 2. 强制评分引用对话原句作为证据，分数可人工核验。
 * 3. 维度名/键写死进 prompt，杜绝 LLM 猜 key（此前猜错会被丢弃）。
 */

/** 产品默认分制 */
export const DEFAULT_SCORE_SCALE: ScoreScale = 5;

/** 某分制下的低/中/高三档锚点分数 */
export function anchorScores(
  scale: ScoreScale = DEFAULT_SCORE_SCALE
): readonly [number, number, number] {
  return scale === 100 ? [20, 60, 100] : [1, 3, 5];
}

/** 某分制的取值下限（百分制允许 0 分，5 分制最低 1 分） */
export function scoreFloor(scale: ScoreScale = DEFAULT_SCORE_SCALE): number {
  return scale === 100 ? 0 : 1;
}

/** 解析失败 / 字段缺失时的兜底分（取中档锚点） */
export function defaultScoreOf(scale: ScoreScale = DEFAULT_SCORE_SCALE): number {
  return anchorScores(scale)[1];
}

/** 把外部输入（请求体字段）归一化成合法分制，非法值一律回落 5 分制 */
export function normalizeScale(scale: unknown): ScoreScale {
  return scale === 100 ? 100 : DEFAULT_SCORE_SCALE;
}

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  logic: "表达逻辑",
  depth: "专业深度",
  data: "数据思维",
  agility: "应变能力",
};

interface Anchor {
  /** 该档的典型表现（行为描述，不是抽象形容词） */
  desc: string;
}

interface DimensionRubric {
  key: DimensionKey;
  label: string;
  /** 该维度重点考察什么 */
  focus: string;
  /** 低/中/高三档锚点，必须按此顺序排列（prompt 按数组位置配分值） */
  anchors: Anchor[];
}

const RUBRICS: DimensionRubric[] = [
  {
    key: "logic",
    label: DIMENSION_LABELS.logic,
    focus: "回答是否结构化、有因果链条，而非想到哪说到哪",
    anchors: [
      { desc: "回答零散跳跃，无结构；说不清因果，前后矛盾" },
      { desc: "有一定结构（如先结论后展开），但逻辑链不完整或偶有断裂" },
      { desc: "结构清晰（结论-论据-例证），因果推导完整，层层递进" },
    ],
  },
  {
    key: "depth",
    label: DIMENSION_LABELS.depth,
    focus: "对项目/问题的理解深度：是否讲清为什么，而不只是做了什么",
    anchors: [
      { desc: "停留在做了什么，说不清目的、机制或取舍；理解浮于表面" },
      { desc: "能讲清部分目的与决策，但关键环节的理解不深" },
      { desc: "能讲清业务本质、机制原理、决策取舍与边界，有体系化思考" },
    ],
  },
  {
    key: "data",
    label: DIMENSION_LABELS.data,
    focus: "是否用数字说话、能否拆指标、是否懂度量与验证",
    anchors: [
      { desc: "全程无具体数字；说效果用'挺好的'；不会拆指标" },
      { desc: "能报出个别数字，但口径不清（如不提时间窗/基线/定义）" },
      { desc: "数字口径清晰（基线/时间窗/定义），能拆指标、有对比与验证（如 AB）" },
    ],
  },
  {
    key: "agility",
    label: DIMENSION_LABELS.agility,
    focus: "面对面试官追问时的临场应变：能否接住追问、不卡壳、不回避，并把话题往深处推进",
    anchors: [
      { desc: "被追问就卡壳、答非所问，或回避问题、顾左右而言他" },
      { desc: "能接住部分追问，但回答浮于表面，未就追问往深处推进" },
      { desc: "被追问能正面接住并主动深化，把问题引向更本质的层面" },
    ],
  },
];

/**
 * 拼出 rubric 的 prompt 文本（给 LLM 的评分标准）。
 * @param scale 分制（5 或 100）；百分制用于分制对比实验
 */
export function buildRubricPromptText(scale: ScoreScale = DEFAULT_SCORE_SCALE): string {
  const [low, mid, high] = anchorScores(scale);
  const adjacent =
    scale === 100 ? "档位之间可取中间值（按接近程度给分，不必只给锚点分）" : "相邻可取 2/4";
  return (
    "【评分标准 - 必须逐条对照打分，每个维度都要有】\n" +
    `本次采用 ${scale} 分制，三档锚点为 ${low}/${mid}/${high}，分值不得低于 ${scoreFloor(scale)}、不得高于 ${scale}。\n` +
    RUBRICS.map(
      (r) =>
        `维度「${r.label}」(key=${r.key})：考察${r.focus}\n` +
        r.anchors.map((a, i) => `  ${[low, mid, high][i]} 分：${a.desc}`).join("\n") +
        `\n  打分规则：先判断回答最接近哪一档的描述（${low}/${mid}/${high}），${adjacent}。必须给出 evidence，从面试实录中引用候选人的原话片段作为打分依据；找不到证据支撑的分数是不允许的。`
    ).join("\n") +
    `\n【反趋中 - 必须遵守】不同候选人的表现是有高下之分的，四维分数不应趋同。请对照各维锚点，明确区分强弱：回答真正达到高/低档描述的，就果断给 ${high} 或 ${low}，不要因为犹豫而默认塞进 ${mid}。宁可给错极端分，也不要四维都打同一个中间分。`
  );
}

/** 校验维度 key 是否合法 */
export function isValidDimensionKey(key: unknown): key is DimensionKey {
  return typeof key === "string" && key in DIMENSION_LABELS;
}
