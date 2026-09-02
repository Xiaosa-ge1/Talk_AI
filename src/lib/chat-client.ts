import type { ChatMessage, ChatStreamEvent } from "./types";

/**
 * 浏览器端聊天流式客户端：调 /api/chat 并解析 SSE。
 * 封装成纯解析逻辑 + fetch 调用，便于组件复用与测试。
 */

export interface StreamChatHandlers {
  onText: (delta: string) => void;
  /** 流结束（成功） */
  onDone?: () => void;
  /** 服务端返回错误（error 事件或 HTTP 错误） */
  onError: (message: string) => void;
}

/** 解析一行 SSE（OpenAI 兼容格式：`data: {...}`） */
export function parseChatEventLine(line: string): ChatStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as ChatStreamEvent;
    if (json && typeof json.type === "string") return json;
    return null;
  } catch {
    return null;
  }
}

async function readResponseBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      result += line + "\n";
    }
  }
  if (buffer.trim()) result += buffer;
  return result;
}

/**
 * 发送一轮对话并处理流式事件。
 * @param body /api/chat 请求体
 * @param handlers 事件回调
 */
export async function streamChat(
  body: {
    resume: string;
    messages: ChatMessage[];
    questionCount: number;
    userMessage: string;
  },
  handlers: StreamChatHandlers
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError("网络异常，无法连接服务");
    return;
  }

  if (!res.ok) {
    let message = "请求失败，请重试";
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      // ignore json parse failure
    }
    handlers.onError(message);
    return;
  }

  const raw = await readResponseBody(res);
  const lines = raw.split("\n");
  for (const line of lines) {
    const event = parseChatEventLine(line);
    if (!event) continue;
    if (event.type === "text") {
      handlers.onText(event.delta);
    } else if (event.type === "done") {
      handlers.onDone?.();
    } else if (event.type === "error") {
      handlers.onError(event.message);
    }
  }
}
