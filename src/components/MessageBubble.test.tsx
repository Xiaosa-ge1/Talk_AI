import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatMessage } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";

function assistant(content: string): ChatMessage {
  return { id: "a1", role: "assistant", content, createdAt: 1 };
}

describe("MessageBubble", () => {
  it("AI 消息且提供 onSpeak 时显示朗读按钮，点击回调", async () => {
    const onSpeak = vi.fn();
    const user = userEvent.setup();
    render(<MessageBubble message={assistant("请自我介绍")} onSpeak={onSpeak} />);
    const btn = screen.getByTestId("speak-button");
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onSpeak).toHaveBeenCalledTimes(1);
  });

  it("朗读中显示停止态（isSpeaking）", () => {
    render(<MessageBubble message={assistant("你好")} onSpeak={vi.fn()} isSpeaking />);
    expect(screen.getByTestId("speak-stop-button")).toBeInTheDocument();
  });

  it("不提供 onSpeak 时不显示朗读按钮（如不支持语音的环境）", () => {
    render(<MessageBubble message={assistant("你好")} />);
    expect(screen.queryByTestId("speak-button")).not.toBeInTheDocument();
  });

  it("用户消息不显示朗读按钮", () => {
    const userMsg: ChatMessage = { id: "u1", role: "user", content: "我的回答", createdAt: 1 };
    render(<MessageBubble message={userMsg} onSpeak={vi.fn()} />);
    expect(screen.queryByTestId("speak-button")).not.toBeInTheDocument();
  });
});
