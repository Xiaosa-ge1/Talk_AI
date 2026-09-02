"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, saveSession } from "@/lib/store";
import {
  appendMessage,
  countAnswers,
  createStreamingAssistantPlaceholder,
  finalizeAssistantMessage,
  isAtQuestionLimit,
} from "@/lib/session";
import { streamChat } from "@/lib/chat-client";
import type { ChatMessage, InterviewSession } from "@/lib/types";

type Phase = "loading" | "ready" | "thinking";

/**
 * 对话页 —— 面试主循环。
 * 状态机：ready(等作答) → thinking(AI 生成中禁输入) → ready
 * 会话从 IndexedDB 按 ?id= 加载；无历史则 AI 开场。
 */
export function InterviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id");

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [input, setInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** 向 AI 发送一轮：流式渲染 → 落库 → 恢复可输入 */
  const askAI = useCallback(async (current: InterviewSession, userMessage: string) => {
    setPhase("thinking");
    setNotice(null);
    const updated = userMessage.trim() ? appendMessage(current, "user", userMessage) : current;
    // 先插入空占位 assistant 气泡用于流式渲染
    const placeholder = createStreamingAssistantPlaceholder();
    const withPlaceholder: InterviewSession = {
      ...updated,
      messages: [...updated.messages, placeholder],
      updatedAt: Date.now(),
    };
    setSession(withPlaceholder);

    let acc = "";
    let finished = false;
    const patchLast = (content: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const msgs = prev.messages.map((m) => (m.id === placeholder.id ? { ...m, content } : m));
        return { ...prev, messages: msgs, updatedAt: Date.now() };
      });
    };

    await streamChat(
      {
        resume: updated.resume,
        messages: current.messages,
        questionCount: updated.questionCount,
        userMessage,
      },
      {
        onText: (delta) => {
          acc += delta;
          if (!finished) patchLast(acc);
        },
        onDone: () => {
          finished = true;
          const final = finalizeAssistantMessage(withPlaceholder, acc);
          void saveSession(final).then(() => setSession(final));
          setPhase("ready");
        },
        onError: (msg) => {
          finished = true;
          // 移除占位气泡，恢复可输入
          setSession(updated);
          setNotice(msg);
          setPhase("ready");
        },
      }
    );
  }, []);

  // 加载会话（sessionId 变化时），无历史则开场
  const loadedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || loadedRef.current === sessionId) return;
    loadedRef.current = sessionId;
    void getSession(sessionId).then((s) => {
      if (!s) {
        router.replace("/");
        return;
      }
      setSession(s);
      setPhase("ready");
      if (s.messages.length === 0) {
        void askAI(s, "");
      } else {
        const last = s.messages[s.messages.length - 1];
        if (last.role === "assistant" && !last.content.trim()) {
          // 上次中断在生成中：重新请求
          void askAI(s, "");
        }
      }
    });
  }, [sessionId, router, askAI]);

  // 自动滚动到底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session?.messages, phase]);

  const handleSubmit = useCallback(() => {
    if (!session || phase !== "ready" || !input.trim()) return;
    const text = input.trim();
    setInput("");
    void askAI(session, text);
  }, [session, phase, input, askAI]);

  const handleEndInterview = useCallback(() => {
    if (!session) return;
    if (countAnswers(session) < 2) {
      setNotice("对话还太短，至少回答 2 轮再结束才能生成有效报告");
      setConfirmOpen(false);
      return;
    }
    // 标记 completed 并跳报告页（report 由报告页生成）
    const ended: InterviewSession = { ...session, status: "completed", updatedAt: Date.now() };
    void saveSession(ended).then(() => router.push(`/report?id=${session.id}&generate=1`));
  }, [session, router]);

  if (!session || phase === "loading") {
    return <div className="p-8 text-center text-ink-secondary">加载中…</div>;
  }

  const answers = countAnswers(session);
  const atLimit = isAtQuestionLimit(session);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-ink-muted hover:text-ink" aria-label="返回首页">
              ←
            </Link>
            <span className="text-[14px] font-semibold text-ink">产品经理面试</span>
            <span className="rounded-full bg-soft-gray px-2 py-0.5 text-[12px] text-ink-secondary">
              {answers} / {session.questionCount} 题
            </span>
            {atLimit && <span className="text-[12px] text-primary">已达目标题量，可以结束啦</span>}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-primary/50 hover:text-primary"
          >
            结束面试
          </button>
        </div>
      </header>

      {/* 消息区 */}
      <div ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto mb-6 max-w-md rounded-xl bg-soft-blue p-3 text-center text-[13px] leading-5 text-ink-secondary">
          💡 像真实面试一样作答。AI
          一次问一题，你答完提交，它会顺着你的经历追问。随时可点「结束面试」生成报告。
        </div>
        <div className="space-y-5">
          {session.messages.map((m) => (
            <MessageBubble key={m.id} message={m} streaming={phase === "thinking"} />
          ))}
          {phase === "thinking" &&
            !session.messages.some((m) => m.role === "assistant" && m.content === "") && (
              <div className="flex gap-1.5 pl-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-muted"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-border bg-soft-orange px-3 py-2 text-[13px] text-ink">
            {notice}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-end gap-2 px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={phase !== "ready"}
            placeholder={
              phase === "thinking"
                ? "面试官正在思考…"
                : "输入你的回答（Enter 提交，Shift+Enter 换行）"
            }
            rows={1}
            className="max-h-40 flex-1 resize-none rounded-xl border border-border px-3.5 py-2.5 text-[14px] leading-6 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary disabled:bg-soft-gray disabled:text-ink-muted"
            data-testid="answer-input"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={phase !== "ready" || !input.trim()}
            className="rounded-xl bg-primary px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            data-testid="send-button"
          >
            发送
          </button>
        </div>
        <p className="pb-2 text-center text-[12px] text-ink-muted">对话数据仅保存在本浏览器</p>
      </footer>

      {/* 结束确认弹窗 */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="确认结束面试"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
            <h3 className="text-[16px] font-semibold text-ink">确认结束这次面试？</h3>
            <p className="mt-2 text-[14px] leading-6 text-ink-secondary">
              结束会立即生成你的面试报告（已答 {answers} 题）。生成后仍可回到首页重新开始。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-soft-gray"
              >
                再答几题
              </button>
              <button
                type="button"
                onClick={() => void handleEndInterview()}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                结束并生成报告
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 单条消息气泡（Notion 风格：AI 白卡片，用户蓝填充） */
function MessageBubble({ message, streaming }: { message: ChatMessage; streaming?: boolean }) {
  const isAi = message.role === "assistant";
  const isStreamingEmpty = streaming && isAi && message.content === "";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-6 ${
          isAi ? "border border-border bg-white text-ink" : "bg-primary text-white"
        }`}
      >
        {isStreamingEmpty ? <span className="text-ink-muted">正在思考…</span> : message.content}
        {streaming && isAi && message.content && (
          <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary align-middle" />
        )}
      </div>
    </div>
  );
}
