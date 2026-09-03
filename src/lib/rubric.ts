import type { DimensionKey } from "./types";

/**
 * 报告评分标准（rubric）—— 让 LLM 打分有依据、可解释、可复验。
 *
 * 设计原则：
 * 1. 每维给 1/3/5 分的「行为锚点」，LLM 不再是"凭感觉打 4 分"，
 *    而是对照行为描述判断"更接近哪一档"。
 * 2. 强制评分引用对话原句作为证据，分数可人工核验。
 * 3. 维度名/键写死进 prompt，杜绝 LLM 猜 key（此前猜错会被丢弃）。
 */

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  logic: "表达逻辑",
  depth: "专业深度",
  data: "数据思维",
  agility: "应变能力",
};

interface Anchor {
  score: 1 | 3 | 5;
  /** 该分数的典型表现（行为描述，不是抽象形容词） */
  desc: string;
}

interface DimensionRubric {
  key: DimensionKey;
  label: string;
  /** 该维度重点考察什么 */
  focus: string;
  anchors: Anchor[];
}

const RUBRICS: DimensionRubric[] = [
  {
    key: "logic",
    label: DIMENSION_LABELS.logic,
    focus: "回答是否结构化、有因果链条，而非想到哪说到哪",
    anchors: [
      { score: 1, desc: "回答零散跳跃，无结构；说不清因果，前后矛盾" },
      { score: 3, desc: "有一定结构（如先结论后展开），但逻辑链不完整或偶有断裂" },
      { score: 5, desc: "结构清晰（结论-论据-例证），因果推导完整，层层递进" },
    ],
  },
  {
    key: "depth",
    label: DIMENSION_LABELS.depth,
    focus: "对项目/问题的理解深度：是否讲清为什么，而不只是做了什么",
    anchors: [
      { score: 1, desc: "停留在做了什么，说不清目的、机制或取舍；理解浮于表面" },
      { score: 3, desc: "能讲清部分目的与决策，但关键环节的理解不深" },
      { score: 5, desc: "能讲清业务本质、机制原理、决策取舍与边界，有体系化思考" },
    ],
  },
  {
    key: "data",
    label: DIMENSION_LABELS.data,
    focus: "是否用数字说话、能否拆指标、是否懂度量与验证",
    anchors: [
      { score: 1, desc: "全程无具体数字；说效果用'挺好的'；不会拆指标" },
      { score: 3, desc: "能报出个别数字，但口径不清（如不提时间窗/基线/定义）" },
      { score: 5, desc: "数字口径清晰（基线/时间窗/定义），能拆指标、有对比与验证（如 AB）" },
    ],
  },
  {
    key: "agility",
    label: DIMENSION_LABELS.agility,
    focus: "面对追问/复盘时的应变：能否承认不足并给出可执行的改进",
    anchors: [
      { score: 1, desc: "被追问就卡壳或答非所问；复盘说不出教训或只会归咎外部" },
      { score: 3, desc: "能应对部分追问，复盘有教训但较笼统" },
      { score: 5, desc: "被追问能接住并深化；复盘具体、归因内部、改进可执行" },
    ],
  },
];

/** 拼出 rubric 的 prompt 文本（给 LLM 的评分标准） */
export function buildRubricPromptText(): string {
  return (
    "【评分标准 - 必须逐条对照打分，每个维度都要有】\n" +
    RUBRICS.map(
      (r) =>
        `维度「${r.label}」(key=${r.key})：考察${r.focus}\n` +
        r.anchors.map((a) => `  ${a.score} 分：${a.desc}`).join("\n") +
        "\n  打分规则：先判断回答最接近哪一档的描述（1/3/5），相邻可取 2/4。必须给出 evidence，从面试实录中引用候选人的原话片段作为打分依据；找不到证据支撑的分数是不允许的。"
    ).join("\n")
  );
}

/** 校验维度 key 是否合法 */
export function isValidDimensionKey(key: unknown): key is DimensionKey {
  return typeof key === "string" && key in DIMENSION_LABELS;
}
