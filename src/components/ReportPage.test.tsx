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

  it("无报告且 generate=1 时调用 /api/report 并保存", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ report: makeReport() }),
      })
    );
    render(<ReportPage />);

    expect(await screen.findByText("表现良好")).toBeInTheDocument();
    // 报告已保存（completed 会话 + report）
    expect(saveSession).toHaveBeenCalledTimes(1);
    const saved = (saveSession as ReturnType<typeof vi.fn>).mock.calls[0][0] as InterviewSession;
    expect(saved.report?.summary).toBe("表现良好");
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
