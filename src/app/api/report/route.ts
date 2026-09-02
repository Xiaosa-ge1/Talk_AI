import { NextRequest } from "next/server";
import { createDefaultLlmClient } from "@/lib/deepseek";
import { generateReport, type ReportLlm } from "@/lib/report";
import type { ReportRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/report
 * 无状态：前端携带 resume + 完整问答历史，服务端生成结构化报告。
 * 报告 JSON 解析失败自动重试一次；LLM 异常返回 500（前端降级提示）。
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

  // DeepSeekClient 只暴露 streamChat；报告用非流式一次取完
  const llm: ReportLlm = {
    complete: async (msgs) => {
      let full = "";
      await client.streamChat({
        messages: msgs.map((m) => ({ role: m.role, content: m.content })),
        onDelta: (delta) => {
          full += delta;
        },
      });
      return full;
    },
  };

  try {
    const report = await generateReport({
      resume: resume ?? "",
      questionCount: questionCount ?? 10,
      messages,
      llm,
    });
    if (!report) {
      return Response.json(
        { error: "报告生成失败：AI 输出无法解析，请重试", code: "parse_failed" },
        { status: 422 }
      );
    }
    return Response.json({ report });
  } catch (err) {
    console.error("report generation error:", err);
    return Response.json({ error: "报告生成失败，请稍后重试", code: "llm_error" }, { status: 500 });
  }
}
