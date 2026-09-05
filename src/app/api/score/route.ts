import { NextRequest } from "next/server";
import { createDefaultLlmClient, type LlmUsage } from "@/lib/deepseek";
import { buildScoreSystemPrompt, buildScoreUserPrompt, parseScore } from "@/lib/score";
import { normalizeScale } from "@/lib/rubric";
import type { ReportRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/score（SSE 流式，轻量「只打分」）
 * 与 /api/report 的区别：只让 LLM 输出四维分数 + 简短 evidence，
 * 不生成 summary / improvements / highlight，省 token、低延迟。
 * 供评测脚本批量测「四维打分水平」使用；产品侧仍走 /api/report。
 */
export async function POST(request: NextRequest) {
  let body: ReportRequestBody;
  try {
    body = (await request.json()) as ReportRequestBody;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { resume, messages, scale } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "对话内容为空，无法评分" }, { status: 400 });
  }
  const reportScale = normalizeScale(scale);

  let client;
  try {
    client = createDefaultLlmClient();
  } catch (err) {
    console.error("score: LLM client init failed", err);
    return Response.json({ error: "服务端未配置 LLM 密钥" }, { status: 500 });
  }

  const system = buildScoreSystemPrompt(resume ?? "", reportScale);
  const user = buildScoreUserPrompt(messages);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // 解析失败重试一次（重试只提示输出纯 JSON）；usage 跨轮次累加，不漏算重试消耗
      let totalUsage: LlmUsage | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        let raw = "";
        try {
          const llmMessages = [
            { role: "system" as const, content: system },
            {
              role: "user" as const,
              content: attempt === 0 ? user : user + "\n\n上一次输出无法解析，请只输出纯 JSON。",
            },
          ];
          await client.streamChat({
            messages: llmMessages,
            onDelta: (delta) => {
              raw += delta;
              send({ type: "text", delta });
            },
            onUsage: (u) => {
              totalUsage = totalUsage
                ? {
                    promptTokens: totalUsage.promptTokens + u.promptTokens,
                    completionTokens: totalUsage.completionTokens + u.completionTokens,
                    totalTokens: totalUsage.totalTokens + u.totalTokens,
                  }
                : { ...u };
            },
            temperature: 0.2,
          });
        } catch (err) {
          console.error("score stream error:", err);
          if (attempt === 1) {
            send({ type: "error", message: "评分失败：网络异常，请重试" });
          }
          continue;
        }

        const result = parseScore(raw, reportScale);
        if (result) {
          send({ type: "done", result, usage: totalUsage });
          break;
        }
        if (attempt === 1) {
          send({ type: "error", message: "评分失败：AI 输出无法解析，请重试" });
        }
      }
      controller.close();
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
