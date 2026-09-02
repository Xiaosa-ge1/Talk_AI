import { describe, expect, it } from "vitest";
import {
  appendMessage,
  completeSession,
  countAnswers,
  createSession,
  finalizeAssistantMessage,
  isAtQuestionLimit,
} from "./session";
import type { InterviewReport } from "./types";

describe("createSession", () => {
  it("生成带唯一 id 的进行中会话", () => {
    const s1 = createSession("简历", 8);
    const s2 = createSession("简历", 8);
    expect(s1.id).not.toBe(s2.id);
    expect(s1.status).toBe("in_progress");
    expect(s1.resume).toBe("简历");
    expect(s1.questionCount).toBe(8);
    expect(s1.messages).toHaveLength(0);
    expect(s1.report).toBeNull();
  });

  it("简历做 trim", () => {
    expect(createSession("  简历  ", 8).resume).toBe("简历");
  });
});

describe("appendMessage / countAnswers", () => {
  it("追加消息不改原对象", () => {
    const s = createSession("", 8);
    const s2 = appendMessage(s, "user", "我是张三");
    expect(s.messages).toHaveLength(0);
    expect(s2.messages).toHaveLength(1);
    expect(countAnswers(s2)).toBe(1);
  });

  it("countAnswers 只数 user 消息", () => {
    let s = createSession("", 8);
    s = appendMessage(s, "assistant", "请自我介绍");
    s = appendMessage(s, "user", "我是张三");
    s = appendMessage(s, "assistant", "你做过什么项目？");
    expect(countAnswers(s)).toBe(1);
  });
});

describe("finalizeAssistantMessage", () => {
  it("更新最后一条 assistant 消息内容", () => {
    let s = createSession("", 8);
    s = appendMessage(s, "assistant", "你好"); // 占位空内容
    s = { ...s, messages: [{ ...s.messages[0], content: "" }] };
    s = finalizeAssistantMessage(s, "你好，请做自我介绍");
    expect(s.messages[s.messages.length - 1].content).toBe("你好，请做自我介绍");
    expect(s.messages).toHaveLength(1);
  });

  it("没有 assistant 占位时追加一条", () => {
    const s = createSession("", 8);
    const s2 = finalizeAssistantMessage(s, "开场白");
    expect(s2.messages).toHaveLength(1);
    expect(s2.messages[0].role).toBe("assistant");
    expect(s2.messages[0].content).toBe("开场白");
  });
});

describe("isAtQuestionLimit / completeSession", () => {
  it("达到题量返回 true", () => {
    let s = createSession("", 2);
    s = appendMessage(s, "user", "回答1");
    expect(isAtQuestionLimit(s)).toBe(false);
    s = appendMessage(s, "user", "回答2");
    expect(isAtQuestionLimit(s)).toBe(true);
  });

  it("completeSession 挂报告并置 completed", () => {
    const s = createSession("", 8);
    const report: InterviewReport = {
      summary: "表现不错",
      dimensions: [],
      improvements: [],
      highlight: { question: "", quote: "", praise: "" },
      createdAt: Date.now(),
    };
    const done = completeSession(s, report);
    expect(done.status).toBe("completed");
    expect(done.report?.summary).toBe("表现不错");
    expect(s.status).toBe("in_progress"); // 原对象不变
  });
});
