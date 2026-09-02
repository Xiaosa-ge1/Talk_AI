import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReportEventLine, streamReport } from "./report-client";
import type { InterviewReport } from "./types";

const report: InterviewReport = {
  summary: "表现良好",
  dimensions: [
    { key: "logic", label: "表达逻辑", score: 4, comment: "清晰" },
    { key: "depth", label: "专业深度", score: 3, comment: "" },
    { key: "data", label: "数据思维", score: 4, comment: "" },
    { key: "agility", label: "应变能力", score: 3, comment: "" },
  ],
  improvements: [],
  highlight: { question: "", quote: "", praise: "" },
  createdAt: Date.now(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseReportEventLine", () => {
  it("解析 text 事件", () => {
    expect(parseReportEventLine('data: {"type":"text","delta":"你好"}')).toEqual({
      type: "text",
      delta: "你好",
    });
  });

  it("解析 done 事件（携带 report）", () => {
    const line = `data: ${JSON.stringify({ type: "done", report })}`;
    const event = parseReportEventLine(line);
    expect(event?.type).toBe("done");
    if (event?.type === "done") expect(event.report.summary).toBe("表现良好");
  });

  it("[DONE]/空行/非法返回 null", () => {
    expect(parseReportEventLine("data: [DONE]")).toBeNull();
    expect(parseReportEventLine("")).toBeNull();
    expect(parseReportEventLine("not-json")).toBeNull();
  });
});

describe("streamReport", () => {
  function sseResponse(events: Array<Record<string, unknown>>): Response {
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("逐 text 回调并最终 onDone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "text", delta: "第一段" },
          { type: "text", delta: "第二段" },
          { type: "done", report },
        ])
      )
    );
    const deltas: string[] = [];
    const onDone = vi.fn();
    await streamReport(
      { resume: "", messages: [], questionCount: 8 },
      { onText: (d) => deltas.push(d), onDone, onError: () => undefined }
    );
    expect(deltas).toEqual(["第一段", "第二段"]);
    expect(onDone).toHaveBeenCalledWith(report);
  });

  it("网络异常回调 onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const onError = vi.fn();
    await streamReport(
      { resume: "", messages: [], questionCount: 8 },
      { onDone: () => undefined, onError }
    );
    expect(onError).toHaveBeenCalledWith("网络异常，无法连接服务");
  });

  it("HTTP 非 2xx 回调错误文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "服务端未配置 LLM 密钥" }), { status: 500 })
        )
    );
    const onError = vi.fn();
    await streamReport(
      { resume: "", messages: [], questionCount: 8 },
      { onDone: () => undefined, onError }
    );
    expect(onError).toHaveBeenCalledWith("服务端未配置 LLM 密钥");
  });

  it("error 事件直接回调", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse([{ type: "error", message: "生成失败" }]))
    );
    const onError = vi.fn();
    await streamReport(
      { resume: "", messages: [], questionCount: 8 },
      { onDone: () => undefined, onError }
    );
    expect(onError).toHaveBeenCalledWith("生成失败");
  });
});
