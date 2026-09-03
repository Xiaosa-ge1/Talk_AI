import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { InterviewSession } from "@/lib/types";

// ---- 共享 mock 状态（vi.hoisted 让 mock 工厂能引用闭包变量）----
const h = vi.hoisted(() => ({
  streamChat: vi.fn(),
  getSession: vi.fn(),
  saveSession: vi.fn(),
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  searchParams: new URLSearchParams("id=session-1"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.routerPush, replace: h.routerReplace }),
  useSearchParams: () => h.searchParams,
}));
vi.mock("@/lib/store", () => ({
  getSession: (id: string) => h.getSession(id),
  saveSession: (s: unknown) => h.saveSession(s),
}));
vi.mock("@/lib/chat-client", () => ({
  streamChat: (...args: unknown[]) => h.streamChat(...args),
}));

import { useInterviewChat } from "./useInterviewChat";

// streamChat 回调的处理器类型（避免测试里写 any 触发 AGENTS 红线）
type StreamHandlers = {
  onText: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
};

// ---- 夹具 ----
function makeSession(overrides: Partial<InterviewSession> & { id: string }): InterviewSession {
  const t = Date.now();
  return {
    resume: "",
    questionCount: 8,
    status: "in_progress",
    messages: [],
    report: null,
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

function assistant(content: string) {
  return { id: `a-${Math.random()}`, role: "assistant" as const, content, createdAt: Date.now() };
}
function user(content: string) {
  return { id: `u-${Math.random()}`, role: "user" as const, content, createdAt: Date.now() };
}

// 让 mock 的 streamChat 正常走完（onText + onDone）
function streamOk(text = "你好，请自我介绍") {
  h.streamChat.mockImplementation(async (_body: unknown, handlers: StreamHandlers) => {
    handlers.onText(text);
    handlers.onDone();
  });
}
// 让 mock 的 streamChat 报错（onError）
function streamError(msg = "网络异常，请重试") {
  h.streamChat.mockImplementation(async (_body: unknown, handlers: StreamHandlers) => {
    handlers.onError(msg);
  });
}
// 断言不应触发 AI 调用
function streamMustNotCall() {
  h.streamChat.mockImplementation(() => {
    throw new Error("streamChat 不应被调用");
  });
}

beforeEach(() => {
  h.searchParams = new URLSearchParams("id=session-1");
  h.getSession.mockReset();
  h.saveSession.mockReset().mockResolvedValue(undefined);
  h.streamChat.mockReset();
  h.routerPush.mockReset();
  h.routerReplace.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useInterviewChat 状态机", () => {
  it("正式会话有历史且无中断 → 加载后 ready，不触发 AI", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍"), user("我是张三"), assistant("介绍个项目")],
    });
    h.getSession.mockResolvedValue(session);
    streamMustNotCall();

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.session?.id).toBe("session-1");
    expect(h.streamChat).not.toHaveBeenCalled();
  });

  it("新会话（空历史）→ 自动 AI 开场，phase 回 ready 且多出一条 assistant", async () => {
    const session = makeSession({ id: "session-1", messages: [] });
    h.getSession.mockResolvedValue(session);
    streamOk("你好，我是面试官");

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(h.streamChat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    // 开场白被落为一条 assistant 消息
    expect(result.current.session?.messages.at(-1)?.role).toBe("assistant");
    expect(result.current.session?.messages.at(-1)?.content).toBe("你好，我是面试官");
  });

  it("中断恢复（最后一条 assistant 内容为空）→ 重新请求 AI", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍"), user("我是张三"), assistant("")],
    });
    h.getSession.mockResolvedValue(session);
    streamOk("刚才断掉了，我们继续");

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(h.streamChat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.session?.messages.at(-1)?.content).toBe("刚才断掉了，我们继续");
  });

  it("submit 空/纯空白输入被忽略，不触发新 AI 调用", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍")],
    });
    h.getSession.mockResolvedValue(session);
    streamMustNotCall();

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.setInput("   "));
    await act(async () => result.current.submit());
    expect(h.streamChat).not.toHaveBeenCalled();

    await act(async () => result.current.setInput(""));
    await act(async () => result.current.submit());
    expect(h.streamChat).not.toHaveBeenCalled();
  });

  it("submit 有效输入 → 组装 userMessage 调用 AI 并插入占位气泡", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍")],
    });
    h.getSession.mockResolvedValue(session);
    streamOk("收到，请继续");

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.setInput("我负责过 3 个产品"));
    await act(async () => result.current.submit());
    await waitFor(() => expect(h.streamChat).toHaveBeenCalledTimes(1));

    const callArgs = h.streamChat.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
      userMessage: string;
    };
    expect(callArgs.userMessage).toBe("我负责过 3 个产品");
    expect(callArgs.messages).toHaveLength(1); // 历史只有 AI 问题
    // 思考阶段出现占位 assistant，结束后被填实
    expect(result.current.session?.messages.at(-1)?.content).toBe("收到，请继续");
  });

  it("AI 报错 → notice 出现、phase 回 ready、占位气泡被移除", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍")],
    });
    h.getSession.mockResolvedValue(session);
    streamError("网络异常，请重试");

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.setInput("我的回答"));
    await act(async () => result.current.submit());
    await waitFor(() => expect(result.current.notice).toBe("网络异常，请重试"));
    expect(result.current.phase).toBe("ready");
    // 占位气泡被移除，但用户刚输入的回答被保留（报错后无需重打）
    expect(result.current.session?.messages).toHaveLength(2);
    expect(result.current.session?.messages.at(-1)).toMatchObject({
      role: "user",
      content: "我的回答",
    });
    expect(h.routerReplace).not.toHaveBeenCalled();
  });

  it("结束正式会话不足 2 轮 → 提示且不跳转", async () => {
    const session = makeSession({
      id: "session-1",
      messages: [assistant("请自我介绍"), user("我是张三")], // 仅 1 轮
    });
    h.getSession.mockResolvedValue(session);
    streamMustNotCall();

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.endInterview());
    await waitFor(() => expect(result.current.notice).toContain("至少回答 2 轮"));
    expect(h.routerPush).not.toHaveBeenCalled();
  });

  it("结束正式会话满 2 轮 → 标记 completed 并跳报告页", async () => {
    const session = makeSession({
      id: "session-x",
      messages: [
        assistant("请自我介绍"),
        user("我是张三"),
        assistant("介绍个项目"),
        user("我做了推荐系统"),
      ],
    });
    h.getSession.mockResolvedValue(session);
    streamMustNotCall();

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.endInterview());
    await waitFor(() => expect(h.routerPush).toHaveBeenCalled());
    expect(h.routerPush).toHaveBeenCalledWith("/report?id=session-x&generate=1");
    expect(h.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-x", status: "completed" })
    );
  });

  it("结束临时（重答）会话 → 直接回首页，不生成报告", async () => {
    h.searchParams = new URLSearchParams("resume=张三简历&seed=目标问题");
    streamOk("我们重练这道题");

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.isTemporary).toBe(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));

    await act(async () => result.current.endInterview());
    await waitFor(() => expect(h.routerPush).toHaveBeenCalledWith("/"));
    // 不跳报告页
    expect(h.routerPush).not.toHaveBeenCalledWith(expect.stringContaining("/report"));
  });

  it("派生值 answers / atLimit 随会话更新", async () => {
    const session = makeSession({
      id: "session-1",
      questionCount: 2,
      messages: [assistant("q1"), user("a1"), assistant("q2"), user("a2")], // 2 轮，达上限
    });
    h.getSession.mockResolvedValue(session);
    streamMustNotCall();

    const { result } = renderHook(() => useInterviewChat());
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.answers).toBe(2);
    expect(result.current.atLimit).toBe(true);
  });
});
