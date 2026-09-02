import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChatEventLine, streamChat } from "./chat-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseChatEventLine", () => {
  it("解析 text 事件", () => {
    expect(parseChatEventLine('data: {"type":"text","delta":"你好"}')).toEqual({
      type: "text",
      delta: "你好",
    });
  });

  it("解析 done 事件", () => {
    expect(parseChatEventLine('data: {"type":"done","messageId":"m1"}')).toEqual({
      type: "done",
      messageId: "m1",
    });
  });

  it("解析 error 事件", () => {
    expect(parseChatEventLine('data: {"type":"error","message":"出错"}')).toEqual({
      type: "error",
      message: "出错",
    });
  });

  it("[DONE] 与空行返回 null", () => {
    expect(parseChatEventLine("data: [DONE]")).toBeNull();
    expect(parseChatEventLine("")).toBeNull();
    expect(parseChatEventLine(": keep-alive")).toBeNull();
  });

  it("非法 JSON 返回 null", () => {
    expect(parseChatEventLine("data: not-json")).toBeNull();
  });
});

describe("streamChat", () => {
  function sseResponse(events: string[]): Response {
    const body = events.map((e) => `data: ${e}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("网络异常回调 onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const onError = vi.fn();
    await streamChat(
      { resume: "", messages: [], questionCount: 8, userMessage: "hi" },
      { onText: () => undefined, onError }
    );
    expect(onError).toHaveBeenCalledWith("网络异常，无法连接服务");
  });

  it("HTTP 非 2xx 回调错误文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "已达到设定题量" }), { status: 400 })
        )
    );
    const onError = vi.fn();
    await streamChat(
      { resume: "", messages: [], questionCount: 8, userMessage: "hi" },
      { onText: () => undefined, onError }
    );
    expect(onError).toHaveBeenCalledWith("已达到设定题量");
  });

  it("逐 text 事件累加并触发 onDone", async () => {
    const res = sseResponse([
      '{"type":"text","delta":"你好"}',
      '{"type":"text","delta":"，请自我介绍"}',
      '{"type":"done","messageId":"m1"}',
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const deltas: string[] = [];
    const onDone = vi.fn();
    await streamChat(
      { resume: "简历", messages: [], questionCount: 8, userMessage: "" },
      { onText: (d) => deltas.push(d), onDone, onError: () => undefined }
    );
    expect(deltas).toEqual(["你好", "，请自我介绍"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("error 事件直接回调不触发 onDone", async () => {
    const res = sseResponse(['{"type":"error","message":"我走神了，请重试"}']);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    const onError = vi.fn();
    const onDone = vi.fn();
    await streamChat(
      { resume: "", messages: [], questionCount: 8, userMessage: "hi" },
      { onText: () => undefined, onDone, onError }
    );
    expect(onError).toHaveBeenCalledWith("我走神了，请重试");
    expect(onDone).not.toHaveBeenCalled();
  });
});
