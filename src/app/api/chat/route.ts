import { NextRequest } from "next/server";
import { createDefaultLlmClient, type LlmMessage } from "@/lib/deepseek";
import { buildMessagesForHistory } from "@/lib/prompts";
import type { ChatRequestBody, ChatStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/chat
 * 无状态 LLM 代理：前端携带 resume + 完整历史 + 本轮回答，
 * 服务端组装 system prompt 后流式转发 DeepSeek 输出。
 * 返回 text/event-stream，事件为 ChatStreamEvent 的 JSON。
 */
export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { resume, messages, questionCount, userMessage } = body;
  if (!Array.isArray(messages) || typeof userMessage !== "string") {
    return Response.json({ error: "参数不完整" }, { status: 400 });
  }

  // 已聊轮数 + 本轮
  const answeredRounds =
    messages.filter((m) => m.role === "user").length + (userMessage.trim() ? 1 : 0);
  if (answeredRounds > questionCount) {
    return Response.json(
      { error: "已达到设定题量，请结束面试生成报告", code: "limit_reached" },
      { status: 400 }
    );
  }

  let client;
  try {
    client = createDefaultLlmClient();
  } catch (err) {
    console.error("LLM client init failed:", err);
    return Response.json(
      { error: "服务端未配置 LLM 密钥，请联系维护者", code: "no_api_key" },
      { status: 500 }
    );
  }

  const llmMessages: LlmMessage[] = buildMessagesForHistory(
    resume,
    questionCount,
    messages,
    userMessage
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const full = await client.streamChat({
          messages: llmMessages,
          signal: request.signal,
          onDelta: (delta) => send({ type: "text", delta }),
        });
        if (!full.trim()) {
          send({ type: "error", message: "AI 没有返回内容，请重试" });
        } else {
          send({ type: "done", messageId: `ai_${Date.now()}` });
        }
      } catch (err) {
        console.error("chat stream error:", err);
        send({
          type: "error",
          message: request.signal.aborted ? "已中断" : "网络开小差了，请重试",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
