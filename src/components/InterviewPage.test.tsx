import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InterviewSession } from "@/lib/types";

// mock next/navigation
const mockRouterReplace = vi.fn();
const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: mockRouterPush }),
  useSearchParams: () => new URLSearchParams("id=session-1"),
}));

// mock store
vi.mock("@/lib/store", () => ({
  getSession: vi.fn(),
  saveSession: vi.fn().mockResolvedValue(undefined),
}));

// mock chat-client（streamChat 捕获 handlers，测试手动触发事件）
const streamChatMock = vi.fn();
vi.mock("@/lib/chat-client", () => ({
  streamChat: (...args: unknown[]) => streamChatMock(...args),
}));

// mock 录音模块：语音可用性可切换，录音器行为可控
const voice = vi.hoisted(() => ({
  isSupported: vi.fn(() => true),
  recorder: {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => new Blob(["audio"], { type: "audio/mp4" })),
    cancel: vi.fn(),
  },
}));
vi.mock("@/lib/recorder", () => ({
  isVoiceInputSupported: () => voice.isSupported(),
  createAudioRecorder: () => voice.recorder,
}));

import { getSession, saveSession } from "@/lib/store";
import { InterviewPage } from "./InterviewPage";

function makeSession(overrides: Partial<InterviewSession> = {}): InterviewSession {
  const t = Date.now();
  return {
    id: "session-1",
    resume: "张三 5 年产品经验",
    questionCount: 8,
    status: "in_progress",
    messages: [],
    report: null,
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

type Handlers = {
  onText: (d: string) => void;
  onDone?: () => void;
  onError: (m: string) => void;
};

beforeEach(() => {
  streamChatMock.mockReset();
  mockRouterReplace.mockReset();
  mockRouterPush.mockReset();
  (getSession as ReturnType<typeof vi.fn>).mockReset();
  (saveSession as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue(undefined);
  voice.isSupported.mockReturnValue(true);
  voice.recorder.start.mockReset().mockResolvedValue(undefined);
  voice.recorder.stop.mockReset().mockResolvedValue(new Blob(["audio"], { type: "audio/mp4" }));
  voice.recorder.cancel.mockReset();
  // 默认 /api/asr 识别成功
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ text: "语音转写的回答" }) }) as Response)
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("InterviewPage", () => {
  it("加载空会话后自动触发 AI 开场（userMessage 为空）", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("你好，我是面试官，请先做自我介绍");
      h.onDone?.();
    });
    render(<InterviewPage />);

    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));
    const body = streamChatMock.mock.calls[0][0] as {
      resume: string;
      messages: unknown[];
      userMessage: string;
    };
    expect(body.userMessage).toBe("");
    expect(body.resume).toContain("张三");
    // AI 开场白渲染
    expect(await screen.findByText(/请先做自我介绍/)).toBeInTheDocument();
  });

  it("用户提交回答 → 组装历史再次调用 AI", async () => {
    const existing: InterviewSession = makeSession({
      messages: [{ id: "a1", role: "assistant", content: "请先自我介绍", createdAt: 1 }],
    });
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(existing);
    // 首次加载不会触发新调用（最后一条 assistant 有内容）
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("收到，请继续");
      h.onDone?.();
    });
    const user = userEvent.setup();
    render(<InterviewPage />);

    await screen.findByText("请先自我介绍");

    await user.type(screen.getByTestId("answer-input"), "我负责过 3 个产品");
    await user.click(screen.getByTestId("send-button"));

    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(1));
    const body = streamChatMock.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
      userMessage: string;
    };
    expect(body.userMessage).toBe("我负责过 3 个产品");
    expect(body.messages).toHaveLength(1); // 历史中只有 AI 问题
  });

  it("生成中（thinking）输入框与发送按钮禁用", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    // 不调用任何回调 → 停留在 thinking
    streamChatMock.mockImplementation(async () => undefined);
    render(<InterviewPage />);

    await waitFor(() => expect(streamChatMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("answer-input")).toBeDisabled());
    expect(screen.getByTestId("send-button")).toBeDisabled();
  });

  it("回答不足 2 轮点结束给提示且不跳转", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("你好");
      h.onDone?.();
    });
    const user = userEvent.setup();
    render(<InterviewPage />);

    await screen.findByText("你好");
    await user.click(screen.getByRole("button", { name: "结束面试" }));
    // 弹窗出现
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "结束并生成报告" }));

    await waitFor(() => expect(screen.getByText(/至少回答 2 轮/)).toBeInTheDocument());
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("回答 2 轮后结束 → 标记 completed 并跳报告页", async () => {
    const session = makeSession({
      messages: [
        { id: "a1", role: "assistant", content: "请先自我介绍", createdAt: 1 },
        { id: "u1", role: "user", content: "我是张三", createdAt: 2 },
        { id: "a2", role: "assistant", content: "介绍一个项目？", createdAt: 3 },
        { id: "u2", role: "user", content: "我做了推荐系统", createdAt: 4 },
      ],
    });
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    const user = userEvent.setup();
    render(<InterviewPage />);

    await screen.findByText("介绍一个项目？");
    await user.click(screen.getByRole("button", { name: "结束面试" }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "结束并生成报告" }));

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalled());
    const url = mockRouterPush.mock.calls[0][0] as string;
    expect(url).toContain("/report?id=session-1");
    // 会话以 completed 保存
    expect(saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1", status: "completed" })
    );
  });

  it("语音不可用时（浏览器不支持）不渲染麦克风按钮", async () => {
    voice.isSupported.mockReturnValue(false);
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("你好");
      h.onDone?.();
    });
    render(<InterviewPage />);
    await screen.findByText("你好");
    expect(screen.queryByTestId("mic-button")).not.toBeInTheDocument();
  });

  it("语音作答：录音 → 停止 → 转写填入输入框 → 可修改后发送", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("请自我介绍");
      h.onDone?.();
    });
    const user = userEvent.setup();
    render(<InterviewPage />);
    await screen.findByText("请自我介绍");

    // 开始录音
    await user.click(screen.getByTestId("mic-button"));
    expect(voice.recorder.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mic-stop-button")).toBeInTheDocument();
    // 录音中不能发送
    expect(screen.getByTestId("send-button")).toBeDisabled();

    // 停止 → 调 /api/asr → 文本填入输入框（用户确认前未发送）
    await user.click(screen.getByTestId("mic-stop-button"));
    await waitFor(() => expect(screen.getByTestId("answer-input")).toHaveValue("语音转写的回答"));
    expect(streamChatMock).toHaveBeenCalledTimes(1); // 仍只有开场那一次，未发送语音文本

    // 用户修改后点发送
    await user.clear(screen.getByTestId("answer-input"));
    await user.type(screen.getByTestId("answer-input"), "我叫张三，做过推荐系统");
    await user.click(screen.getByTestId("send-button"));
    await waitFor(() => expect(streamChatMock).toHaveBeenCalledTimes(2));
    const body = streamChatMock.mock.calls[1][0] as { userMessage: string };
    expect(body.userMessage).toBe("我叫张三，做过推荐系统");
  });

  it("语音识别失败（接口错误）→ notice 提示且不填入文本", async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());
    streamChatMock.mockImplementation(async (_body: unknown, h: Handlers) => {
      h.onText("你好");
      h.onDone?.();
    });
    const fetchMock = vi.fn(
      async () => ({ ok: false, json: async () => ({ error: "额度不足" }) }) as Response
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<InterviewPage />);
    await screen.findByText("你好");

    await user.click(screen.getByTestId("mic-button"));
    await user.click(screen.getByTestId("mic-stop-button"));
    // notice 显示服务端真实错误（而非固定文案）
    await waitFor(() => expect(screen.getByText(/额度不足/)).toBeInTheDocument());
    expect(screen.getByTestId("answer-input")).toHaveValue("");
  });
});
