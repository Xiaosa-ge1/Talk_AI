import { describe, expect, it } from "vitest";
import {
  DIMENSION_LABELS,
  anchorScores,
  buildRubricPromptText,
  defaultScoreOf,
  isValidDimensionKey,
  normalizeScale,
  scoreFloor,
} from "./rubric";
import { buildReportSystemPrompt } from "./report";

describe("rubric", () => {
  it("四个维度各有中文标签", () => {
    expect(DIMENSION_LABELS).toEqual({
      logic: "表达逻辑",
      depth: "专业深度",
      data: "数据思维",
      agility: "应变能力",
    });
  });

  it("prompt 文本覆盖全部维度与 1/3/5 锚点", () => {
    const text = buildRubricPromptText();
    for (const label of Object.values(DIMENSION_LABELS)) {
      expect(text).toContain(label);
    }
    expect(text).toContain("1 分");
    expect(text).toContain("3 分");
    expect(text).toContain("5 分");
    // 要求证据引用
    expect(text).toContain("evidence");
  });

  it("报告 system prompt 包含评分标准", () => {
    const p = buildReportSystemPrompt("简历", 10);
    expect(p).toContain("评分标准");
    expect(p).toContain("logic");
    expect(p).toContain("evidence");
  });

  it("isValidDimensionKey 校验", () => {
    expect(isValidDimensionKey("logic")).toBe(true);
    expect(isValidDimensionKey("speech")).toBe(false);
    expect(isValidDimensionKey(undefined)).toBe(false);
  });
});

describe("rubric · 分制（5 分制 vs 百分制）", () => {
  it("默认 5 分制锚点为 1/3/5，百分制为 20/60/100", () => {
    expect(anchorScores()).toEqual([1, 3, 5]);
    expect(anchorScores(5)).toEqual([1, 3, 5]);
    expect(anchorScores(100)).toEqual([20, 60, 100]);
  });

  it("取值下限与兜底分随分制变化", () => {
    expect(scoreFloor(5)).toBe(1);
    expect(scoreFloor(100)).toBe(0);
    expect(defaultScoreOf(5)).toBe(3);
    expect(defaultScoreOf(100)).toBe(60);
  });

  it("百分制 prompt 声明 100 分制且用百分锚点，不再出现 1/3/5 分", () => {
    const text = buildRubricPromptText(100);
    expect(text).toContain("100 分制");
    expect(text).toContain("20 分");
    expect(text).toContain("60 分");
    expect(text).toContain("100 分");
    // 行为描述与分制无关，四个维度都要在
    for (const label of Object.values(DIMENSION_LABELS)) {
      expect(text).toContain(label);
    }
  });

  it("normalizeScale 只认 100，其余回落 5 分制", () => {
    expect(normalizeScale(100)).toBe(100);
    expect(normalizeScale(5)).toBe(5);
    expect(normalizeScale(undefined)).toBe(5);
    expect(normalizeScale("100")).toBe(5);
    expect(normalizeScale(null)).toBe(5);
  });

  it("报告 prompt 的 score 示例随分制变化（5 分制 3，百分制 60）", () => {
    expect(buildReportSystemPrompt("简历", 10, 5)).toContain('"score": 3');
    const hundred = buildReportSystemPrompt("简历", 10, 100);
    expect(hundred).toContain('"score": 60');
    expect(hundred).toContain("100 分制");
  });
});
