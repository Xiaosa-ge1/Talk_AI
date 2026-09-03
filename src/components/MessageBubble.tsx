import type { ChatMessage } from "@/lib/types";

/** 单条消息气泡（Notion 风格：AI 白卡片，用户蓝填充） */
export function MessageBubble({
  message,
  streaming,
  onSpeak,
  isSpeaking,
}: {
  message: ChatMessage;
  streaming?: boolean;
  /** 提供时 AI 消息显示朗读/停止按钮 */
  onSpeak?: () => void;
  isSpeaking?: boolean;
}) {
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
        {isAi && onSpeak && message.content && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={onSpeak}
              aria-label={isSpeaking ? "停止朗读" : "朗读这段"}
              title={isSpeaking ? "停止朗读" : "朗读这段"}
              className={`rounded-md px-2 py-0.5 text-[12px] transition-colors ${
                isSpeaking
                  ? "bg-primary/10 text-primary"
                  : "text-ink-muted hover:bg-soft-gray hover:text-ink"
              }`}
              data-testid={isSpeaking ? "speak-stop-button" : "speak-button"}
            >
              {isSpeaking ? "⏹ 停止" : "🔊 朗读"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
