import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ChatMessage } from "@/lib/types";
import type { SpeechSynthLike } from "@/lib/speech-synthesis";
import { useAssistantSpeech } from "./useAssistantSpeech";

/** jsdom 无 SpeechSynthesisUtterance，测试提供最小实现 */
class FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;
  onend: ((ev: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((ev: SpeechSynthesisEvent) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

function assistant(id: string, content: string): ChatMessage {
  return { id, role: "assistant", content, createdAt: 1 };
}
function user(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: 1 };
}

function fakeSynth(voices: SpeechSynthesisVoice[] = []): SpeechSynthLike & {
  speakMock: ReturnType<typeof vi.fn>;
  cancelMock: ReturnType<typeof vi.fn>;
} {
  const speakMock = vi.fn();
  const cancelMock = vi.fn();
  return {
    getVoices: () => voices,
    speak: speakMock,
    cancel: cancelMock,
    speakMock,
    cancelMock,
  };
}

/** 最小 zh/en 音色夹具（满足 pickZhVoice 的类型与匹配） */
function zhVoice(name: string): SpeechSynthesisVoice {
  return { name, lang: "zh-CN", localService: true, default: false, voiceURI: name };
}

describe("useAssistantSpeech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("挂载时已有历史消息不朗读（避免进页面重读旧提问）", () => {
    const synth = fakeSynth();
    renderHook(() =>
      useAssistantSpeech({
        messages: [assistant("a1", "请自我介绍"), user("u1", "我是张三")],
        synth,
        supported: true,
      })
    );
    expect(synth.speakMock).not.toHaveBeenCalled();
  });

  it("新 assistant 消息到达自动朗读，并用中文音色", async () => {
    const zh = zhVoice("Microsoft Xiaoxiao Online (Natural)");
    const synth = fakeSynth([zh]);
    const { rerender } = renderHook(
      ({ msgs }: { msgs: ChatMessage[] }) =>
        useAssistantSpeech({ messages: msgs, synth, supported: true }),
      { initialProps: { msgs: [assistant("a1", "旧问题")] } }
    );
    expect(synth.speakMock).not.toHaveBeenCalled();

    rerender({ msgs: [assistant("a1", "旧问题"), user("u1", "答"), assistant("a2", "追问来了")] });
    await act(async () => {});
    expect(synth.speakMock).toHaveBeenCalledTimes(1);
    const utterance = synth.speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("追问来了");
    expect(utterance.voice).toBe(zh);
    expect(utterance.lang).toBe("zh-CN");
  });

  it("autoSpeak=false 时不自动朗读", async () => {
    const synth = fakeSynth();
    const { rerender } = renderHook(
      ({ msgs }: { msgs: ChatMessage[] }) =>
        useAssistantSpeech({ messages: msgs, synth, supported: true, autoSpeak: false }),
      { initialProps: { msgs: [assistant("a1", "旧")] } }
    );
    rerender({ msgs: [assistant("a1", "旧"), assistant("a2", "新")] });
    await act(async () => {});
    expect(synth.speakMock).not.toHaveBeenCalled();
  });

  it("同一条消息只自动朗读一次（re-render 不重复）", async () => {
    const synth = fakeSynth();
    const { rerender } = renderHook(
      ({ msgs }: { msgs: ChatMessage[] }) =>
        useAssistantSpeech({ messages: msgs, synth, supported: true }),
      { initialProps: { msgs: [assistant("a1", "旧")] } }
    );
    rerender({ msgs: [assistant("a1", "旧"), assistant("a2", "新")] });
    await act(async () => {});
    rerender({ msgs: [assistant("a1", "旧"), assistant("a2", "新")] });
    await act(async () => {});
    expect(synth.speakMock).toHaveBeenCalledTimes(1);
  });

  it("流式生成期间不朗读半截内容，生成结束才朗读完整消息", async () => {
    const synth = fakeSynth();
    const { rerender } = renderHook(
      ({ msgs, streaming }: { msgs: ChatMessage[]; streaming?: boolean }) =>
        useAssistantSpeech({ messages: msgs, synth, supported: true, streaming }),
      { initialProps: { msgs: [assistant("a1", "历史问题")], streaming: false } }
    );
    // AI 生成中：占位消息只有开头片段 → 不朗读
    rerender({
      msgs: [assistant("a1", "历史问题"), assistant("a2", "你提到最近一")],
      streaming: true,
    });
    await act(async () => {});
    expect(synth.speakMock).not.toHaveBeenCalled();
    // 生成结束：完整消息落库 → 朗读完整内容
    rerender({
      msgs: [
        assistant("a1", "历史问题"),
        assistant("a2", "你提到最近一年在带 4 人团队，讲讲那次决策？"),
      ],
      streaming: false,
    });
    await act(async () => {});
    expect(synth.speakMock).toHaveBeenCalledTimes(1);
    const utterance = synth.speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.text).toBe("你提到最近一年在带 4 人团队，讲讲那次决策？");
  });

  it("手动 speak 设置 speakingId，utterance 结束回调后清空", async () => {
    const synth = fakeSynth();
    const { result } = renderHook(() =>
      useAssistantSpeech({ messages: [], synth, supported: true })
    );
    act(() => {
      result.current.speak("手动朗读", "m1");
    });
    expect(result.current.speakingId).toBe("m1");
    const utterance = synth.speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    act(() => {
      utterance.onend?.({} as SpeechSynthesisEvent);
    });
    expect(result.current.speakingId).toBeNull();
  });

  it("stop 取消朗读并清空状态", () => {
    const synth = fakeSynth();
    const { result } = renderHook(() =>
      useAssistantSpeech({ messages: [], synth, supported: true })
    );
    act(() => {
      result.current.speak("x", "m1");
    });
    act(() => {
      result.current.stop();
    });
    expect(synth.cancelMock).toHaveBeenCalled();
    expect(result.current.speakingId).toBeNull();
  });

  it("supported=false 时 speak 为 no-op", () => {
    const synth = fakeSynth();
    const { result } = renderHook(() =>
      useAssistantSpeech({ messages: [], synth, supported: false })
    );
    act(() => {
      result.current.speak("不应读出");
    });
    expect(synth.speakMock).not.toHaveBeenCalled();
    expect(result.current.supported).toBe(false);
  });

  it("无中文音色时回退 zh-CN 默认语言", async () => {
    const enVoice = {
      name: "Microsoft Aria",
      lang: "en-US",
      localService: true,
      default: true,
      voiceURI: "aria",
    };
    const synth = fakeSynth([enVoice] as SpeechSynthesisVoice[]);
    const { rerender } = renderHook(
      ({ msgs }: { msgs: ChatMessage[] }) =>
        useAssistantSpeech({ messages: msgs, synth, supported: true }),
      { initialProps: { msgs: [assistant("a1", "旧")] } }
    );
    rerender({ msgs: [assistant("a1", "旧"), assistant("a2", "新")] });
    await act(async () => {});
    const utterance = synth.speakMock.mock.calls[0][0] as SpeechSynthesisUtterance;
    expect(utterance.voice).toBeNull(); // 未误设成英文音色
    expect(utterance.lang).toBe("zh-CN");
  });
});
