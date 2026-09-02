// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmClient, LlmMessage } from "@/lib/deepseek";

// 必须在 import route 之前 mock deepseek 模块
vi.mock("@/lib/deepseek", () => {
  const mockStreamChat = vi.fn();
  return {
    createDefaultLlmClient: (): LlmClient => ({
      streamChat: mockStreamChat,
    }),
    parseSseLine: (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return null;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return null;
      try {
        const json = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const c = json.choices?.[0]?.delta?.content;
        return typeof c === "string" ? c : null;
      } catch {
        return null;
      }
    },
    __mockStreamChat: mockStreamChat,
  };
});

const deepseekModule = (await import("@/lib/deepseek")) as unknown as {
  __mockStreamChat: ReturnType<typeof vi.fn>;
};
const mockStreamChat = deepseekModule.__mockStreamChat;
const { POST } = await import("./route");

function fakeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockStreamChat.mockReset();
});

describe("POST /api/chat", () => {
  it("参数不完整返回 400", async () => {
    const res = await POST(fakeRequest({ resume: "" }));
    expect(res.status).toBe(400);
  });

  it("超过题量上限返回 400 limit_reached", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `u${i}`,
      role: "user" as const,
      content: `回答${i}`,
      createdAt: i,
    }));
    const res = await POST(
      fakeRequest({ resume: "", messages, questionCount: 10, userMessage: "再多一轮" })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("limit_reached");
  });

  it("流式转发 LLM 增量并输出 done 事件", async () => {
    mockStreamChat.mockImplementation(async (params: { onDelta: (d: string) => void }) => {
      params.onDelta("你好");
      params.onDelta("，请自我介绍");
      return "你好，请自我介绍";
    });
    const res = await POST(
      fakeRequest({ resume: "简历A", messages: [], questionCount: 8, userMessage: "开始" })
    );
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('"type":"text"');
    expect(sse).toContain('"delta":"你好"');
    expect(sse).toContain('"type":"done"');
    // 验证传给 client 的消息包含 system prompt（带简历）
    const callArgs = mockStreamChat.mock.calls[0][0] as { messages: LlmMessage[] };
    expect(callArgs.messages[0].role).toBe("system");
    expect(callArgs.messages[0].content).toContain("简历A");
  });

  it("LLM 抛错时输出 error 事件而非 500 中断", async () => {
    mockStreamChat.mockRejectedValue(new Error("network down"));
    const res = await POST(
      fakeRequest({ resume: "", messages: [], questionCount: 8, userMessage: "你好" })
    );
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('"type":"error"');
  });
});
