import { describe, expect, it } from "vitest";
import {
  buildReportSystemPrompt,
  buildReportUserPrompt,
  extractJson,
  parseReport,
  sanitizeReport,
} from "./report";
import type { ChatMessage } from "./types";

const sampleMessages: ChatMessage[] = [
  { id: "1", role: "assistant", content: "请自我介绍", createdAt: 1 },
  { id: "2", role: "user", content: "我是张三，5 年产品经验", createdAt: 2 },
];

describe("extractJson", () => {
  it("提取裸 JSON", () => {
    const raw = '{"summary":"好"}';
    expect(extractJson(raw)).toBe(raw);
  });

  it("提取被 markdown 代码块包裹的 JSON", () => {
    const raw = '```json\n{"summary":"好"}\n```';
    expect(extractJson(raw)).toBe('{"summary":"好"}');
  });

  it("容忍前后杂音", () => {
    const raw = '好的，这是报告：\n{"summary":"好"}\n希望有帮助';
    expect(extractJson(raw)).toBe('{"summary":"好"}');
  });

  it("无 JSON 返回 null", () => {
    expect(extractJson("没有任何花括号")).toBeNull();
  });
});

describe("sanitizeReport", () => {
  it("正常报告通过校验", () => {
    const report = sanitizeReport({
      summary: "整体表现不错",
      dimensions: [
        { key: "logic", label: "x", score: 4, comment: "清晰" },
        { key: "depth", label: "x", score: 3, comment: "一般" },
        { key: "data", label: "x", score: 5, comment: "强" },
        { key: "agility", label: "x", score: 2, comment: "弱" },
      ],
      improvements: [{ question: "q", yourAnswer: "a", issue: "数据不足", suggestion: "补充" }],
      highlight: { question: "q", quote: "好", praise: "好" },
    });
    expect(report?.summary).toBe("整体表现不错");
    expect(report?.dimensions).toHaveLength(4);
    expect(report?.dimensions[0].label).toBe("表达逻辑");
  });

  it("缺 summary 返回 null", () => {
    expect(sanitizeReport({})).toBeNull();
    expect(sanitizeReport(null)).toBeNull();
  });

  it("score 越界被收敛到 1-5", () => {
    const report = sanitizeReport({
      summary: "s",
      dimensions: [{ key: "logic", score: 99 }],
    });
    expect(report?.dimensions[0].score).toBe(5);
  });

  it("无 dimensions 时给默认四维", () => {
    const report = sanitizeReport({ summary: "s" });
    expect(report?.dimensions).toHaveLength(4);
  });

  it("improvements 最多保留 3 条且按顺序", () => {
    const report = sanitizeReport({
      summary: "s",
      improvements: [1, 2, 3, 4].map((i) => ({
        question: `q${i}`,
        issue: `issue${i}`,
      })),
    });
    expect(report?.improvements).toHaveLength(3);
    expect(report?.improvements[0].issue).toBe("issue1");
  });
});

describe("parseReport", () => {
  it("解析带代码块的输出", () => {
    const raw = '```json\n{"summary":"不错"}\n```';
    expect(parseReport(raw)?.summary).toBe("不错");
  });

  it("容忍外层 report 包裹结构", () => {
    const raw = '{"report":{"summary":"包了一层","dimensions":[]}}';
    expect(parseReport(raw)?.summary).toBe("包了一层");
  });

  it("非法 JSON 返回 null", () => {
    expect(parseReport("not json")).toBeNull();
  });
});

describe("prompt 组装", () => {
  it("system prompt 含简历与规则", () => {
    const p = buildReportSystemPrompt("张三简历", 10);
    expect(p).toContain("张三简历");
    expect(p).toContain("10");
    expect(p).toContain("improvements");
  });

  it("超长简历被截断（控制 token）", () => {
    const longResume = "工作经历".repeat(800); // 3200 字
    const p = buildReportSystemPrompt(longResume, 10);
    // 截断后 prompt 里出现省略号，且不含简历结尾
    expect(p).toContain("…");
    const resumePortion = p.slice(p.indexOf("【候选人简历】"), p.indexOf("目标题量"));
    expect(resumePortion.length).toBeLessThan(2200);
  });

  it("user prompt 含完整实录", () => {
    const u = buildReportUserPrompt(sampleMessages);
    expect(u).toContain("面试官：请自我介绍");
    expect(u).toContain("候选人：我是张三，5 年产品经验");
  });
});
