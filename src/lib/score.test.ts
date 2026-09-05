import { describe, expect, it } from "vitest";
import { buildScoreSystemPrompt, buildScoreUserPrompt, parseScore } from "./score";

describe("score.ts（轻量只打分）", () => {
  const sampleMessages = [
    { id: "a1", role: "assistant" as const, content: "请自我介绍", createdAt: 1 },
    { id: "u1", role: "user" as const, content: "我是张三，负责推荐系统", createdAt: 2 },
  ];

  it("system prompt 只要求输出四维分数，不含 summary/improvements", () => {
    const s = buildScoreSystemPrompt("张三简历", 5);
    expect(s).toContain("只对下面这场面试的四维表现打分");
    expect(s).toContain("logic");
    expect(s).toContain("depth");
    expect(s).toContain("data");
    expect(s).toContain("agility");
    // 轻量接口不要求报告字段
    expect(s).not.toContain("summary");
    expect(s).not.toContain("improvements");
    expect(s).not.toContain("highlight");
  });

  it("system prompt 含评分标准（rubric）与简历", () => {
    const s = buildScoreSystemPrompt("张三的简历内容", 5);
    expect(s).toContain("评分标准");
    expect(s).toContain("张三的简历内容");
  });

  it("user prompt 含完整实录", () => {
    const u = buildScoreUserPrompt(sampleMessages);
    expect(u).toContain("面试官：请自我介绍");
    expect(u).toContain("候选人：我是张三，负责推荐系统");
  });

  it("parseScore 解析标准 dimensions 数组", () => {
    const r = parseScore(
      JSON.stringify({
        dimensions: [
          { key: "logic", score: 4, evidence: "原句" },
          { key: "depth", score: 3, evidence: "" },
          { key: "data", score: 5, evidence: "有数字" },
          { key: "agility", score: 2, evidence: "" },
        ],
      }),
      5
    );
    expect(r).not.toBeNull();
    expect(r!.dimensions).toHaveLength(4);
    const byKey = Object.fromEntries(r!.dimensions.map((d) => [d.key, d.score]));
    expect(byKey).toEqual({ logic: 4, depth: 3, data: 5, agility: 2 });
  });

  it("parseScore 容忍 markdown 围栏与越界分", () => {
    const r = parseScore(
      "```json\n" +
        JSON.stringify({
          dimensions: [
            { key: "logic", score: 99, evidence: "" },
            { key: "depth", score: 3, evidence: "" },
            { key: "data", score: 0, evidence: "" },
            { key: "agility", score: 3, evidence: "" },
          ],
        }) +
        "\n```",
      5
    );
    expect(r).not.toBeNull();
    const byKey = Object.fromEntries(r!.dimensions.map((d) => [d.key, d.score]));
    expect(byKey.logic).toBe(5); // 99 收敛到 5
    expect(byKey.data).toBe(1); // 0 收敛到 1（5 分制下限）
  });

  it("parseScore 容忍对象形态 {logic:{...},...}", () => {
    const r = parseScore(
      JSON.stringify({
        logic: { score: 4 },
        depth: { score: 3 },
        data: { score: 2 },
        agility: { score: 3 },
      }),
      5
    );
    expect(r).not.toBeNull();
    expect(r!.dimensions).toHaveLength(4);
  });

  it("parseScore 对非法 JSON 返回 null", () => {
    expect(parseScore("这不是 JSON", 5)).toBeNull();
  });
});
