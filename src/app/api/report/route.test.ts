// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@/lib/deepseek";

vi.mock("@/lib/deepseek", () => {
  const streamChat = vi.fn();
  return {
    createDefaultLlmClient: (): LlmClient => ({
      streamChat: streamChat as unknown as LlmClient["streamChat"],
    }),
    __mockStreamChat: streamChat,
  };
});

const { __mockStreamChat } = (await import("@/lib/deepseek")) as unknown as {
  __mockStreamChat: ReturnType<typeof vi.fn>;
};
const { POST } = await import("./route");

function fakeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/report", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const messages = [
  { id: "1", role: "assistant" as const, content: "请自我介绍", createdAt: 1 },
  { id: "2", role: "user" as const, content: "我是张三", createdAt: 2 },
];

function validReportJson(): string {
  return JSON.stringify({
    summary: "整体表现不错，逻辑清晰",
    dimensions: [
      { key: "logic", label: "表达逻辑", score: 4, comment: "清晰" },
      { key: "depth", label: "专业深度", score: 3, comment: "一般" },
      { key: "data", label: "数据思维", score: 5, comment: "强" },
      { key: "agility", label: "应变能力", score: 3, comment: "中等" },
    ],
    improvements: [{ question: "q1", yourAnswer: "a1", issue: "数据不足", suggestion: "补充指标" }],
    highlight: { question: "q2", quote: "原话", praise: "好" },
  });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  __mockStreamChat.mockReset();
});

describe("POST /api/report", () => {
  it("参数不完整返回 400", async () => {
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
  });

  it("空对话返回 400", async () => {
    const res = await POST(fakeRequest({ resume: "", messages: [], questionCount: 8 }));
    expect(res.status).toBe(400);
  });

  it("成功生成并返回报告", async () => {
    __mockStreamChat.mockImplementation(async (params: { onDelta: (d: string) => void }) => {
      params.onDelta(validReportJson());
      return validReportJson();
    });
    const res = await POST(fakeRequest({ resume: "张三简历", messages, questionCount: 8 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { report?: { summary?: string } };
    expect(body.report?.summary).toContain("整体表现不错");
    // 校验传给 LLM 的消息含简历与实录
    const callArgs = __mockStreamChat.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const joined = callArgs.messages.map((m) => m.content).join("\n");
    expect(joined).toContain("张三简历");
    expect(joined).toContain("我是张三");
  });

  it("AI 输出无法解析 → 重试后仍失败返回 422", async () => {
    __mockStreamChat.mockImplementation(async (params: { onDelta: (d: string) => void }) => {
      params.onDelta("抱歉我不会生成 JSON");
      return "抱歉我不会生成 JSON";
    });
    const res = await POST(fakeRequest({ resume: "", messages, questionCount: 8 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("parse_failed");
  });

  it("LLM 抛错返回 500", async () => {
    __mockStreamChat.mockRejectedValue(new Error("network down"));
    const res = await POST(fakeRequest({ resume: "", messages, questionCount: 8 }));
    expect(res.status).toBe(500);
  });
});
