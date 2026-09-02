import type { ChatMessage, InterviewSession } from "./types";

/**
 * 会话工厂与纯逻辑 —— 客户端创建/推进面试会话。
 * 纯函数为主，便于单测；IndexedDB 读写由调用方通过 store 完成。
 */

let idCounter = 0;

/** 生成会话/消息 id（浏览器与测试环境均可用） */
export function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `id_${Date.now()}_${idCounter}`;
}

export function now(): number {
  return Date.now();
}

/** 创建新会话（首页「开始面试」时调用） */
export function createSession(resume: string, questionCount: number): InterviewSession {
  const t = now();
  return {
    id: genId(),
    resume: resume.trim(),
    questionCount,
    status: "in_progress",
    messages: [],
    report: null,
    createdAt: t,
    updatedAt: t,
  };
}

/** 追加一条消息并刷新 updatedAt（返回新副本，不修改原对象） */
export function appendMessage(
  session: InterviewSession,
  role: ChatMessage["role"],
  content: string
): InterviewSession {
  const message: ChatMessage = {
    id: genId(),
    role,
    content,
    createdAt: now(),
  };
  return {
    ...session,
    messages: [...session.messages, message],
    updatedAt: now(),
  };
}

/** 把最后一条 assistant 消息标记为完成（流式渲染结束时用），返回新副本 */
export function finalizeAssistantMessage(
  session: InterviewSession,
  content: string
): InterviewSession {
  const messages = [...session.messages];
  if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
    messages[messages.length - 1] = { ...messages[messages.length - 1], content };
  } else {
    messages.push({ id: genId(), role: "assistant", content, createdAt: now() });
  }
  return { ...session, messages, updatedAt: now() };
}

/** 已完成的问答轮数 = user 消息数 */
export function countAnswers(session: InterviewSession): number {
  return session.messages.filter((m) => m.role === "user").length;
}

/** 会话是否达到目标题量（供 UI 提示"可以结束了"） */
export function isAtQuestionLimit(session: InterviewSession): boolean {
  return countAnswers(session) >= session.questionCount;
}

/** 把会话标记为 completed 并挂上报告，返回新副本 */
export function completeSession(
  session: InterviewSession,
  report: NonNullable<InterviewSession["report"]>
): InterviewSession {
  return {
    ...session,
    status: "completed",
    report,
    updatedAt: now(),
  };
}

/** 生成一条占位 assistant 消息用于流式渲染（id 供前端引用） */
export function createStreamingAssistantPlaceholder(): ChatMessage {
  return { id: genId(), role: "assistant", content: "", createdAt: now() };
}
