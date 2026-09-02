import { describe, expect, it } from "vitest";
import { consumeSseStream, parseSseLine } from "./deepseek";

describe("parseSseLine", () => {
  it("解析文本增量", () => {
    const line = 'data: {"choices":[{"delta":{"content":"你好"}}]}';
    expect(parseSseLine(line)).toBe("你好");
  });

  it("解析空 content 为 null", () => {
    const line = 'data: {"choices":[{"delta":{}}]}';
    expect(parseSseLine(line)).toBeNull();
  });

  it("[DONE] 返回 null", () => {
    expect(parseSseLine("data: [DONE]")).toBeNull();
  });

  it("非 data 行（注释）返回 null", () => {
    expect(parseSseLine(": keep-alive")).toBeNull();
    expect(parseSseLine("")).toBeNull();
  });

  it("非法 JSON 返回 null（容错，不抛错）", () => {
    expect(parseSseLine("data: not-json")).toBeNull();
  });
});

describe("consumeSseStream", () => {
  function streamFromText(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
  }

  it("跨 chunk 拼接完整的行", async () => {
    const lines: string[] = [];
    // 把一行 data 拆成两个 chunk 发过来，验证 buffer 拼接正确
    const stream = streamFromText(['data: {"choices":[{"delta":{"con', 'tent":"你好"}}]}\n\n']);
    await consumeSseStream(stream, (l) => lines.push(l));
    const deltas = lines.map(parseSseLine).filter((d): d is string => d !== null);
    expect(deltas).toEqual(["你好"]);
  });

  it("多行全部处理", async () => {
    const lines: string[] = [];
    const stream = streamFromText([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n',
      "data: [DONE]\n",
    ]);
    await consumeSseStream(stream, (l) => lines.push(l));
    expect(lines).toHaveLength(3);
  });
});
