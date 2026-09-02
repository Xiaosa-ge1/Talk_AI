import type { InterviewReport, ReportRequestBody, ReportStreamEvent } from "./types";

/**
 * 浏览器端报告生成客户端：调 /api/report（SSE）并解析事件。
 * text 事件逐段回调（供进度条估算）；done 携带最终报告。
 */

export interface ReportStreamHandlers {
  /** LLM 原始文本增量（用于进度估算，不直接展示） */
  onText?: (delta: string) => void;
  /** 报告生成完成 */
  onDone: (report: InterviewReport) => void;
  /** 失败 */
  onError: (message: string) => void;
}

/** 解析一行 SSE（格式同 chat：`data: {...}`） */
export function parseReportEventLine(line: string): ReportStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as ReportStreamEvent;
    if (json && typeof json.type === "string") return json;
    return null;
  } catch {
    return null;
  }
}

/**
 * 请求报告生成。
 * @param body ReportRequestBody
 * @param handlers 事件回调
 */
export async function streamReport(
  body: ReportRequestBody,
  handlers: ReportStreamHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError("网络异常，无法连接服务");
    return;
  }

  if (!res.ok) {
    let message = "报告生成失败，请重试";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // ignore
    }
    handlers.onError(message);
    return;
  }

  if (!res.body) {
    handlers.onError("服务异常，请重试");
    return;
  }

  // 逐行解析 SSE
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseReportEventLine(line);
      if (!event) continue;
      if (event.type === "text") {
        handlers.onText?.(event.delta);
      } else if (event.type === "done") {
        handlers.onDone(event.report);
      } else if (event.type === "error") {
        handlers.onError(event.message);
      }
    }
  }
}
