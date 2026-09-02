/**
 * DeepSeek 流式客户端 —— 可注入接口设计。
 *
 * 测试原则：LlmClient 是抽象接口，测试注入 fake 实现，
 * 不发起真实网络请求；SSE 行解析拆成纯函数单独测试。
 */

export interface LlmMessage {
  role: "system" | "assistant" | "user";
  content: string;
}

export interface StreamChatParams {
  messages: LlmMessage[];
  /** 每个文本增量的回调 */
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LlmClient {
  streamChat(params: StreamChatParams): Promise<string>;
}

/**
 * 解析 OpenAI 兼容 SSE 的一行。
 * 输入形如 `data: {"choices":[{"delta":{"content":"你好"}}]}`；
 * `data: [DONE]` 表示结束；非 data 行（注释/空行）返回 null。
 * @returns 该行携带的文本增量；无法解析时返回 null
 */
export function parseSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return null;
  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

/** 从 ReadableStream（UTF-8 文本）逐行产出，供 parseSseLine 使用 */
export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  }
  if (buffer.trim()) {
    onLine(buffer);
  }
}

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";

/** 真实 DeepSeek 客户端（服务端使用；key 来自环境变量） */
export class DeepSeekClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
    private readonly endpoint = DEEPSEEK_ENDPOINT
  ) {}

  async streamChat({ messages, onDelta, signal }: StreamChatParams): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: 0.8,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => "");
      throw new Error(`DeepSeek request failed: ${response.status} ${body.slice(0, 200)}`);
    }

    let full = "";
    await consumeSseStream(response.body, (line) => {
      const delta = parseSseLine(line);
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    });
    return full;
  }
}

/** 默认客户端工厂：从服务端环境变量读取 key */
export function createDefaultLlmClient(): LlmClient {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error("DEEPSEEK_API_KEY 未配置：请在 .env.local 中设置");
  }
  return new DeepSeekClient(key);
}
