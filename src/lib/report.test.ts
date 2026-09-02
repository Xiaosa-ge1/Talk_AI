import { describe, expect, it, vi } from "vitest";
import {
  buildReportSystemPrompt,
  buildReportUserPrompt,
  extractJson,
  generateReport,
  parseReport,
  sanitizeReport,
  type ReportLlm,
} from "./report";
import type { ChatMessage } from "./types";

const sampleMessages: ChatMessage[] = [
  { id: "1", role: "assistant", content: "请自我介绍", createdAt: 1 },
  { id: "2", role: "user", content: "我是张三，5 年产品经验", createdAt: 2 },
];

function fakeLlm(output: string | ((attempt: number) => string)): ReportLlm {
  let calls = 0;
  const fn = typeof output === "function" ? output : () => output;
  return {
    complete: vi.fn(async () => {
      const result = fn(calls);
      calls += 1;
      return result;
    }),
  };
}

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

  it("非法 JSON 返回 null", () => {
    expect(parseReport("not json")).toBeNull();
  });
});

describe("generateReport", () => {
  it("成功路径返回报告", async () => {
    const llm = fakeLlm('{"summary":"不错"}');
    const report = await generateReport({
      resume: "",
      questionCount: 8,
      messages: sampleMessages,
      llm,
    });
    expect(report?.summary).toBe("不错");
  });

  it("解析失败自动重试一次成功", async () => {
    const llm = fakeLlm((attempt: number) =>
      attempt === 0 ? "抱歉我输出错了" : '{"summary":"重试成功"}'
    );
    const report = await generateReport({
      resume: "",
      questionCount: 8,
      messages: sampleMessages,
      llm,
    });
    expect(report?.summary).toBe("重试成功");
  });

  it("多次失败返回 null", async () => {
    const llm = fakeLlm("全是杂音没有 JSON");
    const report = await generateReport({
      resume: "",
      questionCount: 8,
      messages: sampleMessages,
      llm,
      maxAttempts: 2,
    });
    expect(report).toBeNull();
  });

  it("LLM 抛错且重试后仍抛错则向上抛", async () => {
    const llm: ReportLlm = {
      complete: vi.fn().mockRejectedValue(new Error("network down")),
    };
    await expect(
      generateReport({
        resume: "",
        questionCount: 8,
        messages: sampleMessages,
        llm,
        maxAttempts: 2,
      })
    ).rejects.toThrow("report llm call failed");
  });
});

describe("prompt 组装", () => {
  it("system prompt 含简历与规则", () => {
    const p = buildReportSystemPrompt("张三简历", 10);
    expect(p).toContain("张三简历");
    expect(p).toContain("10");
    expect(p).toContain("improvements");
  });

  it("user prompt 含完整实录", () => {
    const u = buildReportUserPrompt(sampleMessages);
    expect(u).toContain("面试官：请自我介绍");
    expect(u).toContain("候选人：我是张三，5 年产品经验");
  });
});
