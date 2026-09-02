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

/** 让 mock 的 streamChat 按块推送文本并结束 */
function mockStreaming(chunks: string[], { error }: { error?: boolean } = {}) {
  __mockStreamChat.mockImplementation(async (params: { onDelta: (d: string) => void }) => {
    if (error) throw new Error("network down");
    for (const c of chunks) params.onDelta(c);
    return chunks.join("");
  });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  __mockStreamChat.mockReset();
});

describe("POST /api/report (SSE)", () => {
  it("参数不完整返回 400", async () => {
    const res = await POST(fakeRequest({}));
    expect(res.status).toBe(400);
  });

  it("空对话返回 400", async () => {
    const res = await POST(fakeRequest({ resume: "", messages: [], questionCount: 8 }));
    expect(res.status).toBe(400);
  });

  it("流式转发 text 事件并在 done 携带报告", async () => {
    const json = validReportJson();
    // 分两段推文本，模拟流式
    mockStreaming([json.slice(0, 40), json.slice(40)]);
    const res = await POST(fakeRequest({ resume: "张三简历", messages, questionCount: 8 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const sse = await res.text();
    // 应有 text 事件（含部分 JSON）
    expect(sse).toContain('"type":"text"');
    // 最终 done 事件带 report
    expect(sse).toContain('"type":"done"');
    expect(sse).toContain('"summary":"整体表现不错');
    // 校验传给 LLM 的 system prompt 含简历
    const callArgs = __mockStreamChat.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const joined = callArgs.messages.map((m) => m.content).join("\n");
    expect(joined).toContain("张三简历");
    expect(joined).toContain("我是张三");
  });

  it("AI 输出无法解析 → 自动重试（第二次调用带重试提示）", async () => {
    // 第一次输出杂音，第二次输出合法 JSON
    __mockStreamChat
      .mockImplementationOnce(async (params: { onDelta: (d: string) => void }) => {
        params.onDelta("抱歉我不会 JSON");
        return "抱歉我不会 JSON";
      })
      .mockImplementationOnce(async (params: { onDelta: (d: string) => void }) => {
        params.onDelta(validReportJson());
        return validReportJson();
      });

    const res = await POST(fakeRequest({ resume: "", messages, questionCount: 8 }));
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('"type":"done"');
    expect(__mockStreamChat).toHaveBeenCalledTimes(2);
    // 第二次调用的 user 消息应包含重试提示
    const secondCall = __mockStreamChat.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondCall.messages[1].content).toContain("只输出纯 JSON");
  });

  it("LLM 抛错时输出 error 事件", async () => {
    mockStreaming([], { error: true });
    const res = await POST(fakeRequest({ resume: "", messages, questionCount: 8 }));
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('"type":"error"');
  });
});
