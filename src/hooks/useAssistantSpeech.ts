import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { isSpeechSupported, pickZhVoice, type SpeechSynthLike } from "@/lib/speech-synthesis";

/**
 * AI 朗读状态机：新 assistant 消息自动朗读（可关），气泡可重听/停止。
 *
 * seam：SpeechSynthesis（浏览器全局、jsdom 无）经窄接口注入，测试用 fake。
 * 只朗读「流式落库后的完整消息」——消息列表由调用方传入，hook 追踪尾部变化。
 */

export interface UseAssistantSpeechOptions {
  /** 当前消息列表（由面试页传入，hook 据此发现「新」的 assistant 消息） */
  messages: ChatMessage[];
  /** 是否正处于 AI 流式生成中：流式期间消息在逐片填充，不能朗读半截，等完整落库后再读 */
  streaming?: boolean;
  /** 注入 seam（默认取 window.speechSynthesis） */
  synth?: SpeechSynthLike | null;
  /** 自动朗读开关初始值（默认开） */
  autoSpeak?: boolean;
  /** 支持性探测（默认 isSpeechSupported） */
  supported?: boolean;
}

export interface UseAssistantSpeechState {
  supported: boolean;
  autoSpeak: boolean;
  setAutoSpeak: (value: boolean) => void;
  /** 正在朗读的消息 id（null = 未朗读） */
  speakingId: string | null;
  /** 朗读一段文本（可关联消息 id 用于高亮） */
  speak: (text: string, messageId?: string) => void;
  stop: () => void;
}

/** 真实合成器（惰性取全局，避免 SSR 访问 window） */
function realSynth(): SpeechSynthLike | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

export function useAssistantSpeech(options: UseAssistantSpeechOptions): UseAssistantSpeechState {
  const { messages } = options;
  const supported = options.supported ?? isSpeechSupported();
  const [autoSpeak, setAutoSpeak] = useState(options.autoSpeak ?? true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const [synth] = useState<SpeechSynthLike | null>(() =>
    options.synth === undefined ? realSynth() : options.synth
  );

  const speak = useCallback(
    (text: string, messageId?: string) => {
      if (!supported || !text.trim()) return;
      if (!synth) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickZhVoice(synth.getVoices());
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "zh-CN";
      }
      utterance.rate = 1;
      const finish = () => setSpeakingId((cur) => (cur === (messageId ?? null) ? null : cur));
      utterance.onend = finish;
      utterance.onerror = finish;
      setSpeakingId(messageId ?? null);
      synth.speak(utterance);
    },
    [supported, synth]
  );

  const stop = useCallback(() => {
    if (synth) synth.cancel();
    setSpeakingId(null);
  }, [synth]);

  // 卸载时停止朗读（离开页面不能让 AI 声音继续播到别的页面）
  useEffect(() => stop, [stop]);

  // 首次拿到非空消息时标记历史基线：进入页面不重读已存在的旧提问。
  // null = 尚未标记；"" = 已标记但历史里没有 assistant 消息；其余 = 最后一条历史 AI id
  // 注意：不因 streaming 而推迟标记——开场白是页面加载后才生成的新消息，
  // 首帧（messages 为空）就应把基线锁定为""，这样开场白生成后被正确识别为"新消息"并朗读。
  const streaming = options.streaming ?? false;
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSpokenRef.current !== null || messages.length === 0) return;
    const lastHistoryAi = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.trim() !== "");
    lastSpokenRef.current = lastHistoryAi ? lastHistoryAi.id : "";
  }, [messages]);

  // 自动朗读：AI 生成结束后发现比基线更新的一条完整 assistant 消息
  useEffect(() => {
    if (streaming || !autoSpeak || !supported) return;
    const lastAi = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.trim() !== "");
    if (!lastAi) return;
    if (lastSpokenRef.current === lastAi.id) return;
    lastSpokenRef.current = lastAi.id;
    speak(lastAi.content, lastAi.id);
  }, [messages, streaming, autoSpeak, supported, speak]);

  return {
    supported,
    autoSpeak,
    setAutoSpeak,
    speakingId,
    speak,
    stop,
  };
}
