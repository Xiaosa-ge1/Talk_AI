/**
 * 浏览器录音封装 —— 采集 16k 16bit 单声道 PCM（讯飞语音听写 iat 要求裸 PCM）。
 * 用 AudioContext({sampleRate:16000}) 让浏览器重采样，ScriptProcessorNode 逐块取 Float32。
 * 浏览器能力圈在 adapter 内；jsdom 无 AudioContext，测试只覆盖纯转换函数。
 * 注：ScriptProcessorNode 已 deprecated 但 Edge/Chrome 仍广泛支持；AudioWorklet 是后续替代。
 */

export interface AudioRecorder {
  /** 请求麦克风并开始录音（失败抛错，如无权限） */
  start(): Promise<void>;
  /** 停止并返回 16k 16bit 单声道裸 PCM 的 Blob */
  stop(): Promise<Blob>;
  /** 放弃本次录音（不产出 blob） */
  cancel(): void;
}

/** 录音配置（对话感模式的静音检测参数） */
export interface RecorderOptions {
  /** 连续静音多少毫秒判定"说完了"（默认 1500ms）；不传则不启用自动结束 */
  silenceTimeoutMs?: number;
  /** 判定为静音的音量阈值（RMS，0-1，默认 0.02） */
  silenceThreshold?: number;
  /** 静音判定回调：连续静音达到阈值时触发（供自动结束） */
  onSilence?: () => void;
}

/** 计算一段采样块的 RMS 音量（均方根，0-1；纯函数，可单测） */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/** 静音检测器：累积连续静音时长，达到阈值触发 onSilence（纯逻辑，可单测） */
export interface SilenceDetector {
  /** 喂入一块采样，返回是否刚触发了静音结束 */
  push(samples: Float32Array): boolean;
  /** 重置静音累积（每次开口说话时清零） */
  reset(): void;
}

export function createSilenceDetector(opts: {
  sampleRate: number;
  silenceTimeoutMs: number;
  threshold?: number;
  onSilence: () => void;
}): SilenceDetector {
  const threshold = opts.threshold ?? 0.02;
  let silentSamples = 0;
  const samplesPerTimeout = Math.floor((opts.silenceTimeoutMs / 1000) * opts.sampleRate);
  return {
    push(samples) {
      const rms = computeRms(samples);
      if (rms < threshold) {
        silentSamples += samples.length;
        if (silentSamples >= samplesPerTimeout) {
          silentSamples = 0;
          opts.onSilence();
          return true;
        }
      } else {
        silentSamples = 0;
      }
      return false;
    },
    reset() {
      silentSamples = 0;
    },
  };
}

/** Float32 采样（-1..1）→ 16bit 小端 PCM 字节（纯函数，可单测） */
export function floatSamplesToInt16Pcm(samples: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(samples.length * 2);
  const view = new DataView(out);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const int = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
    view.setInt16(i * 2, int, true);
  }
  return out;
}

/** 当前环境是否支持语音输入（浏览器 + AudioContext + 麦克风 API） */
export function isVoiceInputSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    typeof AudioContext !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

const SAMPLE_RATE = 16000;

/** 创建真实录音器（浏览器端，产出 16k PCM；可选静音自动结束） */
export function createAudioRecorder(options: RecorderOptions = {}): AudioRecorder {
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stream: MediaStream | null = null;
  let chunks: ArrayBuffer[] = [];
  let detector: SilenceDetector | null = null;

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("当前浏览器不支持音频采集");
      }
      ctx = new AudioCtor({ sampleRate: SAMPLE_RATE });
      source = ctx.createMediaStreamSource(stream);
      processor = ctx.createScriptProcessor(4096, 1, 1);
      // 静音检测：连续静音达到阈值触发 onSilence（对话感模式自动结束）
      if (options.silenceTimeoutMs && options.onSilence) {
        detector = createSilenceDetector({
          sampleRate: SAMPLE_RATE,
          silenceTimeoutMs: options.silenceTimeoutMs,
          threshold: options.silenceThreshold,
          onSilence: options.onSilence,
        });
      }
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const samples = e.inputBuffer.getChannelData(0);
        chunks.push(floatSamplesToInt16Pcm(samples));
        detector?.push(samples);
      };
      source.connect(processor);
      processor.connect(ctx.destination); // 需要输出连接才会触发 onaudioprocess
    },
    stop() {
      return new Promise<Blob>((resolve, reject) => {
        if (!ctx || !processor) {
          reject(new Error("没有正在进行的录音"));
          return;
        }
        try {
          processor.disconnect();
          source?.disconnect();
          ctx.close();
        } catch {
          // 已关闭则忽略
        }
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        ctx = null;
        processor = null;
        source = null;
        resolve(new Blob(chunks, { type: "audio/pcm" }));
        chunks = [];
      });
    },
    cancel() {
      try {
        processor?.disconnect();
        source?.disconnect();
        void ctx?.close();
      } catch {
        // 忽略
      }
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      ctx = null;
      processor = null;
      source = null;
      chunks = [];
    },
  };
}
