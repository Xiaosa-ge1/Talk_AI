import type { ChatMessage } from "@/lib/types";

/** 单条消息气泡（Notion 风格：AI 白卡片，用户蓝填充） */
export function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming?: boolean;
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
      </div>
    </div>
  );
}
