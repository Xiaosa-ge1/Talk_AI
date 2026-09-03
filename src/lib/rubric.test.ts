import { describe, expect, it } from "vitest";
import { DIMENSION_LABELS, buildRubricPromptText, isValidDimensionKey } from "./rubric";
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
