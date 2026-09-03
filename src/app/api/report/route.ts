import { NextRequest } from "next/server";
import { createDefaultLlmClient } from "@/lib/deepseek";
import { buildReportSystemPrompt, buildReportUserPrompt, parseReport } from "@/lib/report";
import type { ReportRequestBody, ReportStreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/report（SSE 流式）
 * 无状态：前端携带 resume + 完整问答历史。
 * 生成流程：LLM 流式输出 → 文本增量实时转发前端（供进度条估算）→
 * 文本收完后服务端解析 JSON（失败自动重试一次）→ done 事件携带最终报告。
 */
export async function POST(request: NextRequest) {
  let body: ReportRequestBody;
  try {
    body = (await request.json()) as ReportRequestBody;
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { resume, messages, questionCount } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "对话内容为空，无法生成报告" }, { status: 400 });
  }

  let client;
  try {
    client = createDefaultLlmClient();
  } catch (err) {
    console.error("report: LLM client init failed", err);
    return Response.json({ error: "服务端未配置 LLM 密钥" }, { status: 500 });
  }

  const system = buildReportSystemPrompt(resume ?? "", questionCount ?? 10);
  const user = buildReportUserPrompt(messages);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ReportStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const llmMessages: Array<{ role: "system" | "user"; content: string }> = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];

      // 最多尝试 2 次（JSON 解析失败时重试，重试提示只输出 JSON）
      for (let attempt = 0; attempt < 2; attempt++) {
        let raw = "";
        try {
          const messagesForAttempt =
            attempt === 0
              ? llmMessages
              : [
                  { role: "system" as const, content: system },
                  {
                    role: "user" as const,
                    content: user + "\n\n上一次输出无法解析，请只输出纯 JSON。",
                  },
                ];
          await client.streamChat({
            messages: messagesForAttempt,
            onDelta: (delta) => {
              raw += delta;
              send({ type: "text", delta });
            },
            // 报告是结构化输出，低温提升稳定与解析成功率
            temperature: 0.2,
          });
        } catch (err) {
          console.error("report stream error:", err);
          if (attempt === 1) {
            send({ type: "error", message: "报告生成失败：网络异常，请重试" });
          }
          continue;
        }

        const report = parseReport(raw);
        if (report) {
          send({ type: "done", report });
          break;
        }
        if (attempt === 1) {
          send({ type: "error", message: "报告生成失败：AI 输出无法解析，请重试" });
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
