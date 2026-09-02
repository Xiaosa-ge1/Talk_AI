import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { InterviewReport, InterviewSession } from "@/lib/types";

const { searchParamsState } = vi.hoisted(() => ({
  searchParamsState: { value: "id=session-1&generate=1" },
}));

const mockRouterReplace = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("@/lib/store", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

import { getSession, saveSession } from "@/lib/store";
import { ReportPage } from "./ReportPage";

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  const t = Date.now();
  return {
    id: "session-1",
    resume: "张三",
    questionCount: 8,
    status: "completed",
    messages: [
      { id: "1", role: "assistant", content: "你好", createdAt: 1 },
      { id: "2", role: "user", content: "我是张三", createdAt: 2 },
    ],
    report: null,
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

function makeReport(): InterviewReport {
  return {
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
}

beforeEach(() => {
  searchParamsState.value = "id=session-1&generate=1";
  mockRouterReplace.mockReset();
  mockRouterPush.mockReset();
  (getSession as ReturnType<typeof vi.fn>).mockReset();
  (saveSession as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReportPage", () => {
  it("会话已有报告时直接展示，不调 /api/report", async () => {
    const session = makeSession({ report: makeReport() });
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportPage />);

    expect(await screen.findByText("表现良好")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("无报告且 generate=1 时流式生成并保存", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    // mock SSE 响应：先推文本增量（驱动进度），再 done 携带报告
    const report = makeReport();
    const reportJson = JSON.stringify(report);
    const events = [
      `data: {"type":"text","delta":"${reportJson.slice(0, 30)}"}\n\n`,
      `data: {"type":"text","delta":"${reportJson.slice(30)}"}\n\n`,
      `data: ${JSON.stringify({ type: "done", report })}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(events, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );
    render(<ReportPage />);

    // 完成后展示报告
    expect(await screen.findByText("表现良好")).toBeInTheDocument();
    // 报告已保存（completed 会话 + report）
    expect(saveSession).toHaveBeenCalledTimes(1);
    const saved = (saveSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as InterviewSession;
    expect(saved.report?.summary).toBe("表现良好");
  });

  it("生成中展示进度信号（文本流未结束时显示进度条与阶段文案）", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    // mock 只推 text 事件（不触发 done）→ 页面停留在 generating
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `data: ${JSON.stringify({ type: "text", delta: "这段文字用于驱动进度" })}\n\n`,
            { status: 200, headers: { "Content-Type": "text/event-stream" } }
          )
        )
    );
    render(<ReportPage />);

    // 进度条与生成中文案出现
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText(/AI 正在撰写你的面试报告/)).toBeInTheDocument();
    // 阶段文案随进度切换（初始阶段：通读对话）
    expect(screen.getByText(/正在通读你的面试对话/)).toBeInTheDocument();
    // 已生成字数提示
    expect(screen.getByText(/已生成/)).toBeInTheDocument();
  });

  it("无报告且无 generate 参数时提示未生成", async () => {
    searchParamsState.value = "id=session-1";
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportPage />);

    expect(await screen.findByText(/还没有生成报告/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("生成失败显示错误提示", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "报告生成失败，请重试" }),
      })
    );
    render(<ReportPage />);

    expect(await screen.findByText(/报告生成失败/)).toBeInTheDocument();
    // 错误态展示返回首页入口（顶栏返回箭头 + 主体按钮均指向 /）
    expect(screen.getAllByRole("link", { name: "返回首页" }).length).toBeGreaterThan(0);
  });
});
