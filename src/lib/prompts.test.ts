import { describe, expect, it } from "vitest";
import { buildMessagesForHistory, buildSystemPrompt, INTERVIEW_RULES } from "./prompts";

describe("buildSystemPrompt", () => {
  it("包含简历内容与题量提示", () => {
    const p = buildSystemPrompt("张三的简历内容", 10);
    expect(p).toContain("张三的简历内容");
    expect(p).toContain("10");
    expect(p).toContain(INTERVIEW_RULES);
  });

  it("无简历时明确说明从自我介绍开始", () => {
    const p = buildSystemPrompt("", 8);
    expect(p).toContain("自我介绍");
    expect(p).not.toContain("候选人简历】\n张三");
  });

  it("超长简历被截断（每轮 system prompt 都携带，控制 token）", () => {
    const longResume = "项目经历".repeat(600); // 2400 字 > 2000 上限
    const p = buildSystemPrompt(longResume, 8);
    expect(p).toContain("…");
    // 简历部分（截取到规则文本之前）应明显短于原文
    const resumeSection = p.slice(p.indexOf("【候选人简历】"), p.indexOf("【面试规则"));
    expect(resumeSection.length).toBeLessThan(2100);
  });
});

describe("buildMessagesForHistory", () => {
  it("历史按 role 映射并追加本轮回答", () => {
    const out = buildMessagesForHistory(
      "简历",
      8,
      [
        { id: "1", role: "assistant", content: "你好，请自我介绍", createdAt: 1 },
        { id: "2", role: "user", content: "我是张三", createdAt: 2 },
      ],
      "我负责过三个项目"
    );
    expect(out[0]).toMatchObject({ role: "system" });
    expect(out[1]).toMatchObject({ role: "assistant", content: "你好，请自我介绍" });
    expect(out[2]).toMatchObject({ role: "user", content: "我是张三" });
    expect(out[3]).toMatchObject({ role: "user", content: "我负责过三个项目" });
  });

  it("空 userMessage 不追加 user 消息", () => {
    const out = buildMessagesForHistory("", 8, [], "");
    expect(out.filter((m) => m.role === "user")).toHaveLength(0);
  });

  it("首轮无历史时只有 system 消息（由 route 决定开场）", () => {
    const out = buildMessagesForHistory("简历", 8, [], "开场触发");
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("user");
  });
});
