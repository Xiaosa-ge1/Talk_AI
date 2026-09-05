import { useCallback, useEffect, useRef, useState } from "react";
import { createAudioRecorder, type AudioRecorder } from "@/lib/recorder";

/**
 * 语音作答状态机：录音 → 上传转写 → 回调文本（由页面填入输入框供用户确认编辑）。
 *
 * 对话感模式（silenceAutoStop）：录音中检测到连续静音 1.5 秒，自动停止并转写，
 * 让"说完自动结束"无需手动点停止。自动发送由调用方决定（拿到 onTranscribed 文本后）。
 *
 * seam：浏览器能力（MediaRecorder/getUserMedia）与 /api/asr 调用均可注入，
 * 测试用 fake recorder / fake transcribe，不碰真实浏览器与网络。
 */

export type VoicePhase = "idle" | "recording" | "transcribing";

export interface UseVoiceInputOptions {
  /** 转写成功：把文本交给调用方（填入输入框，供用户修改后发送） */
  onTranscribed: (text: string) => void;
  /** 错误（无麦克风/识别失败/超时等），显示在 notice */
  onError: (message: string) => void;
  /** 注入 seam（默认创建真实录音器；接收静音自动停止配置，供对话感模式） */
  createRecorder?: (opts?: { silenceTimeoutMs?: number; onSilence?: () => void }) => AudioRecorder;
  /** 注入 seam（默认调 /api/asr） */
  transcribe?: (audio: Blob) => Promise<string>;
  /** 单段录音上限（秒），到点自动停止并转写 */
  maxSeconds?: number;
  /** 对话感模式：静音自动停止（默认关闭） */
  silenceAutoStop?: boolean;
  /** 静音判定阈值（秒，默认 1.5） */
  silenceSeconds?: number;
}

export interface UseVoiceInputState {
  phase: VoicePhase;
  /** 录音已进行秒数（供按钮展示） */
  seconds: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
}

/** 默认转写：POST /api/asr（multipart audio）→ { text } */
async function defaultTranscribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "answer.m4a");
  const res = await fetch("/api/asr", { method: "POST", body: form });
  const body = (await res.json()) as { text?: string; error?: string };
  if (!res.ok || typeof body.text !== "string") {
    throw new Error(body.error ?? "识别失败，请重试");
  }
  return body.text;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputState {
  const { onTranscribed, onError } = options;
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<AudioRecorder | null>(null);

  const maxSeconds = options.maxSeconds ?? 60;
  const silenceSeconds = options.silenceSeconds ?? 1.5;
  const transcribe = useCallback(
    (audio: Blob) => (options.transcribe ?? defaultTranscribe)(audio),
    [options.transcribe]
  );

  // phase 的 ref 镜像：供 onSilence / 计时器等异步回调读取最新值，避免闭包捕获旧 state
  const phaseRef = useRef<VoicePhase>("idle");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  async function stopRecording(): Promise<void> {
    const recorder = recorderRef.current;
    if (!recorder || phaseRef.current !== "recording") return;
    setPhase("transcribing");
    setSeconds(0);
    let blob: Blob;
    try {
      blob = await recorder.stop();
    } catch (err) {
      onError(err instanceof Error ? err.message : "录音结束失败");
      setPhase("idle");
      recorderRef.current = null;
      return;
    }
    try {
      const text = await transcribe(blob);
      onTranscribed(text);
    } catch (err) {
      // 展示服务端真实错误（如"服务时长不足"），而非固定文案
      onError(err instanceof Error ? err.message : "语音识别失败，请重试或直接输入文字");
    }
    setPhase("idle");
    recorderRef.current = null;
  }

  // 卸载时释放麦克风（录音中途离开页面不能让音频流常亮）
  useEffect(
    () => () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
    },
    []
  );

  // 录音计时 + 到点自动停止：interval 回调（异步 tick）内判定并触发，
  // 避免在 effect 主体同步 setState（react-hooks/set-state-in-effect）
  const deadlineRef = useRef(0);
  useEffect(() => {
    if (phase !== "recording") return;
    deadlineRef.current = Date.now() + maxSeconds * 1000;
    const timer = setInterval(() => {
      setSeconds((s) => s + 1);
      if (Date.now() >= deadlineRef.current) {
        clearInterval(timer);
        void stopRecording();
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return {
    phase,
    seconds,
    async start() {
      if (phase !== "idle") return;
      let recorder: AudioRecorder;
      try {
        const silence = options.silenceAutoStop
          ? {
              silenceTimeoutMs: Math.round(silenceSeconds * 1000),
              onSilence: () => void stopRecording(),
            }
          : {};
        recorder = options.createRecorder
          ? options.createRecorder(silence)
          : createAudioRecorder(silence);
        await recorder.start();
      } catch (err) {
        onError(err instanceof Error ? err.message : "无法开始录音（请检查麦克风权限）");
        return;
      }
      recorderRef.current = recorder;
      setPhase("recording");
      setSeconds(0);
    },
    async stop() {
      await stopRecording();
    },
    cancel() {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setPhase("idle");
      setSeconds(0);
    },
  };
}
