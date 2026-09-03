import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, saveSession } from "@/lib/store";
import {
  appendMessage,
  countAnswers,
  createSession,
  createStreamingAssistantPlaceholder,
  finalizeAssistantMessage,
  isAtQuestionLimit,
} from "@/lib/session";
import { streamChat } from "@/lib/chat-client";
import type { InterviewSession } from "@/lib/types";

export type InterviewPhase = "loading" | "ready" | "thinking";

export interface InterviewChatState {
  session: InterviewSession | null;
  phase: InterviewPhase;
  input: string;
  setInput: (value: string) => void;
  confirmOpen: boolean;
  setConfirmOpen: (open: boolean) => void;
  notice: string | null;
  /** 设置顶部提示（供语音等扩展功能复用同一提示通道） */
  setNotice: (message: string | null) => void;
  /** 用户提交本轮回答 */
  submit: () => void;
  /** 结束面试（正式会话 → 生成报告；临时会话 → 回首页） */
  endInterview: () => void;
  /** 是否为「重答这题」临时会话（不保存历史、不生成报告） */
  isTemporary: boolean;
  answers: number;
  atLimit: boolean;
}

/**
 * 对话页状态机 hook。
 * 两种进入方式：
 * 1. ?id=<sessionId>：正式面试会话（无历史则 AI 开场）
 * 2. ?resume=&seed=<问题>：报告页「重答这题」的临时练习会话
 * 状态流转：ready(等作答) → thinking(AI 生成中禁输入) → ready
 */
export function useInterviewChat(): InterviewChatState {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("id");
  const resumeParam = searchParams.get("resume");
  const seedParam = searchParams.get("seed");

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [phase, setPhase] = useState<InterviewPhase>("loading");
  const [input, setInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  // 加载会话（?id=）或创建重答临时会话（?resume=&seed=）
  // 记录已处理过的入口标识而非 boolean：dev 模式 effect 双调用只处理一次，
  // 且切换入口（不同 sessionId / 不同 seed 的重练）会正确重新处理
  const handledKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = sessionId ? `session:${sessionId}` : `temp:${seedParam ?? ""}`;
    if (handledKeyRef.current === key) return;
    handledKeyRef.current = key;

    if (sessionId) {
      void getSession(sessionId).then((s) => {
        if (!s) {
          router.replace("/");
          return;
        }
        setSession(s);
        setPhase("ready");
        const needsOpening = s.messages.length === 0;
        const last = s.messages[s.messages.length - 1];
        const interrupted = last && last.role === "assistant" && !last.content.trim();
        if (needsOpening || interrupted) {
          // 无历史开场；或上次中断在生成中重新请求
          void askAI(s, "");
        }
      });
    } else {
      // 报告页「重答这题」入口：新建临时会话
      const questionCount = 10;
      // seed 问题注入 resume 前缀，让 AI 开场即针对性重问该题（复用现有 prompt 通道）
      const effectiveResume = seedParam
        ? `【本次重练目标问题】${seedParam}\n\n${resumeParam ?? ""}`
        : (resumeParam ?? "");
      const temp = createSession(effectiveResume, questionCount);
      Promise.resolve().then(() => {
        setSession(temp);
        setPhase("ready");
        void askAI(temp, "");
      });
    }
  }, [sessionId, resumeParam, seedParam, router, askAI]);

  const submit = useCallback(() => {
    if (!session || phase !== "ready" || !input.trim()) return;
    const text = input.trim();
    setInput("");
    void askAI(session, text);
  }, [session, phase, input, askAI]);

  const endInterview = useCallback(() => {
    if (!session) return;
    // 临时重练会话：结束即回首页，不生成报告
    if (!sessionId) {
      router.push("/");
      return;
    }
    if (countAnswers(session) < 2) {
      setNotice("对话还太短，至少回答 2 轮再结束才能生成有效报告");
      setConfirmOpen(false);
      return;
    }
    // 标记 completed 并跳报告页（report 由报告页生成）
    const ended: InterviewSession = { ...session, status: "completed", updatedAt: Date.now() };
    void saveSession(ended).then(() => router.push(`/report?id=${session.id}&generate=1`));
  }, [session, sessionId, router]);

  const isTemporary = !sessionId;
  return {
    session,
    phase,
    input,
    setInput,
    confirmOpen,
    setConfirmOpen,
    notice,
    setNotice,
    submit,
    endInterview,
    isTemporary,
    answers: session ? countAnswers(session) : 0,
    atLimit: session ? isAtQuestionLimit(session) : false,
  };
}
