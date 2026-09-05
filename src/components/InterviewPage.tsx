"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageBubble } from "./MessageBubble";
import { useInterviewChat } from "@/hooks/useInterviewChat";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useAssistantSpeech } from "@/hooks/useAssistantSpeech";
import { isVoiceInputSupported } from "@/lib/recorder";

/**
 * 对话页 —— 纯 UI 编排。
 * 面试状态机（加载/开场/提交/结束/流式）全部在 useInterviewChat hook。
 * 两种进入方式：
 * 1. ?id=<sessionId>：正式面试会话
 * 2. ?resume=&seed=<问题>：报告页「重答这题」临时会话
 */
export function InterviewPage() {
  const router = useRouter();
  const {
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
    answers,
    atLimit,
  } = useInterviewChat();
  const voiceSupported = isVoiceInputSupported();
  // 对话感模式：录音静音自动结束，转写后自动发送（无需手动确认）
  const [dialogueMode, setDialogueMode] = useState(false);
  const voice = useVoiceInput({
    onTranscribed: (text) => {
      if (dialogueMode) {
        // 对话感模式：自动发送
        submit(text);
      } else {
        setInput(text);
      }
    },
    onError: (message) => setNotice(message),
    silenceAutoStop: dialogueMode,
  });
  const speech = useAssistantSpeech({
    messages: session?.messages ?? [],
    streaming: phase === "thinking",
  });
  if (!session || phase === "loading") {
    return <div className="p-8 text-center text-ink-secondary">加载中…</div>;
  }

  const thinking = phase === "thinking";
  const streamingEmpty = session.messages.some((m) => m.role === "assistant" && m.content === "");
  const voiceBusy = voice.phase !== "idle";
  const sendDisabled = thinking || voiceBusy || !input.trim();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-ink-muted hover:text-ink" aria-label="返回首页">
              ←
            </Link>
            <span className="text-[14px] font-semibold text-ink">
              {isTemporary ? "重练这题" : "产品经理面试"}
            </span>
            {!isTemporary && (
              <span className="rounded-full bg-soft-gray px-2 py-0.5 text-[12px] text-ink-secondary">
                {answers} / {session.questionCount} 题
              </span>
            )}
            {atLimit && !isTemporary && (
              <span className="text-[12px] text-primary">已达目标题量，可以结束啦</span>
            )}
          </div>
          {speech.supported && (
            <button
              type="button"
              onClick={() => speech.setAutoSpeak(!speech.autoSpeak)}
              title={speech.autoSpeak ? "关闭自动朗读" : "开启自动朗读"}
              aria-label="自动朗读开关"
              className={`mr-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                speech.autoSpeak
                  ? "border-primary/40 text-primary"
                  : "border-border text-ink-muted hover:text-ink"
              }`}
              data-testid="auto-speak-toggle"
            >
              {speech.autoSpeak ? "🔊 自动朗读" : "🔇 已静音"}
            </button>
          )}
          {voiceSupported && (
            <button
              type="button"
              onClick={() => setDialogueMode(!dialogueMode)}
              title={dialogueMode ? "关闭对话感模式" : "开启对话感模式：说完自动发送，无需确认"}
              aria-label="对话感模式开关"
              className={`mr-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
                dialogueMode
                  ? "border-primary/40 text-primary"
                  : "border-border text-ink-muted hover:text-ink"
              }`}
              data-testid="dialogue-mode-toggle"
            >
              {dialogueMode ? "🎙️ 对话感" : "🎙️ 确认模式"}
            </button>
          )}
          {isTemporary ? (
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-primary/50 hover:text-primary"
            >
              完成练习
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-primary/50 hover:text-primary"
            >
              结束面试
            </button>
          )}
        </div>
      </header>

      {/* 消息区 */}
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto mb-6 max-w-md rounded-xl bg-soft-blue p-3 text-center text-[13px] leading-5 text-ink-secondary">
          {isTemporary
            ? "🎯 这一轮只练报告里标记的那一题：AI 会重新抛出问题，你组织语言回答，答完可再练或完成。"
            : "💡 像真实面试一样作答。AI 一次问一题，你答完提交，它会顺着你的经历追问。随时可点「结束面试」生成报告。"}
        </div>
        <div className="space-y-5">
          {session.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              streaming={thinking}
              onSpeak={
                m.role === "assistant" && speech.supported
                  ? () => {
                      if (speech.speakingId === m.id) {
                        speech.stop();
                      } else {
                        speech.speak(m.content, m.id);
                      }
                    }
                  : undefined
              }
              isSpeaking={speech.speakingId === m.id}
            />
          ))}
          {thinking && !streamingEmpty && (
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
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // 输入框随内容自动增高（上限 160px）
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sendDisabled) submit();
              }
            }}
            disabled={thinking || voiceBusy}
            placeholder={
              thinking
                ? "面试官正在思考…"
                : voice.phase === "transcribing"
                  ? "正在识别你的语音…"
                  : voice.phase === "recording"
                    ? "正在录音，说完点右侧停止"
                    : "输入或语音作答（可修改后发送）"
            }
            rows={1}
            className="max-h-40 flex-1 resize-none rounded-xl border border-border px-3.5 py-2.5 text-[14px] leading-6 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-primary disabled:bg-soft-gray disabled:text-ink-muted"
            data-testid="answer-input"
          />
          {voiceSupported && voice.phase === "recording" && (
            <button
              type="button"
              onClick={() => void voice.stop()}
              className="rounded-xl bg-red-500 px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-red-600"
              data-testid="mic-stop-button"
            >
              ⏹ {voice.seconds}s
            </button>
          )}
          {voiceSupported && voice.phase === "transcribing" && (
            <span className="whitespace-nowrap rounded-xl bg-soft-gray px-4 py-2.5 text-[13px] text-ink-secondary">
              识别中…
            </span>
          )}
          {voiceSupported && voice.phase === "idle" && (
            <button
              type="button"
              onClick={() => void voice.start()}
              disabled={thinking}
              title="语音作答：录音识别后填入输入框，可修改再发送"
              aria-label="语音作答"
              className="rounded-xl border border-border px-3.5 py-2.5 text-[16px] leading-none transition-colors hover:border-primary/50 disabled:opacity-40"
              data-testid="mic-button"
            >
              🎤
            </button>
          )}
          <button
            type="button"
            onClick={() => submit()}
            disabled={sendDisabled}
            className="rounded-xl bg-primary px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
            data-testid="send-button"
          >
            发送
          </button>
        </div>
        <p className="pb-2 text-center text-[12px] text-ink-muted">
          {isTemporary ? "临时练习，不保存历史" : "对话数据仅保存在本浏览器"}
        </p>
      </footer>

      {/* 结束确认弹窗（仅正式会话） */}
      {confirmOpen && !isTemporary && (
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
                onClick={() => void endInterview()}
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
