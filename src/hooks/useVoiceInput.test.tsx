import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AudioRecorder } from "@/lib/recorder";
import { useVoiceInput } from "./useVoiceInput";

/** 假录音器：测试控制何时产出 blob */
function fakeRecorder(): AudioRecorder & {
  __blob: Blob;
  startMock: ReturnType<typeof vi.fn>;
  stopMock: ReturnType<typeof vi.fn>;
} {
  const startMock = vi.fn(async () => undefined);
  const stopMock = vi.fn(async () => new Blob(["audio"], { type: "audio/mp4" }));
  return {
    __blob: new Blob(["audio"], { type: "audio/mp4" }),
    startMock,
    stopMock,
    start: startMock,
    stop: stopMock,
    cancel: vi.fn(),
  };
}

describe("useVoiceInput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start → recording，stop → 转写成功 → onTranscribed 回调文本", async () => {
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async (_audio: Blob) => "转写出的回答");
    const onTranscribed = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed,
        onError,
        createRecorder: () => recorder,
        transcribe,
      })
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("recording");
    expect(recorder.startMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.stop();
    });
    expect(recorder.stopMock).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(onTranscribed).toHaveBeenCalledWith("转写出的回答");
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("转写失败 → onError 收到消息，不触发 onTranscribed", async () => {
    const recorder = fakeRecorder();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed: vi.fn(),
        onError,
        createRecorder: () => recorder,
        transcribe: async () => {
          throw new Error("识别失败");
        },
      })
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("recording");
    await act(async () => {
      await result.current.stop();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("cancel 不触发转写", async () => {
    const recorder = fakeRecorder();
    const onTranscribed = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed,
        onError: vi.fn(),
        createRecorder: () => recorder,
        transcribe: vi.fn(async () => "x"),
      })
    );

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.phase).toBe("idle");
    expect(recorder.cancel).toHaveBeenCalled();
    expect(onTranscribed).not.toHaveBeenCalled();
  });

  it("录音达到上限自动停止并转写", async () => {
    vi.useFakeTimers();
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async () => "自动停止");
    const onTranscribed = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed,
        onError: vi.fn(),
        createRecorder: () => recorder,
        transcribe,
        maxSeconds: 60,
      })
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("recording");

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });
    expect(recorder.stopMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onTranscribed).toHaveBeenCalledWith("自动停止");
    expect(result.current.phase).toBe("idle");
  });

  it("录音中 exposure 秒数递增，空闲回到 0", async () => {
    vi.useFakeTimers();
    const recorder = fakeRecorder();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed: vi.fn(),
        onError: vi.fn(),
        createRecorder: () => recorder,
        transcribe: vi.fn(async () => ""),
      })
    );
    expect(result.current.seconds).toBe(0);
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.seconds).toBe(5);
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.seconds).toBe(0);
  });

  it("start 时录音器抛错（无麦克风权限）→ onError", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed: vi.fn(),
        onError,
        createRecorder: () => ({
          start: async () => {
            throw new Error("麦克风被拒绝");
          },
          stop: async () => new Blob([]),
          cancel: () => undefined,
        }),
        transcribe: vi.fn(async () => ""),
      })
    );
    await act(async () => {
      await result.current.start();
    });
    expect(onError).toHaveBeenCalled();
    expect(result.current.phase).toBe("idle");
  });

  it("对话感模式：静音自动停止并转写（onSilence 触发自动 stop）", async () => {
    // 捕获 createRecorder 收到的静音配置，模拟录音器内部静音检测触发 onSilence
    let capturedSilence: { silenceTimeoutMs?: number; onSilence?: () => void } | undefined;
    const recorder = fakeRecorder();
    const transcribe = vi.fn(async () => "自动识别的内容");
    const onTranscribed = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed,
        onError: vi.fn(),
        createRecorder: (opts) => {
          capturedSilence = opts;
          return recorder;
        },
        transcribe,
        silenceAutoStop: true,
        silenceSeconds: 1.5,
      })
    );

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.phase).toBe("recording");
    // 静音配置正确传入（1.5 秒 = 1500ms），且带了 onSilence 回调
    expect(capturedSilence?.silenceTimeoutMs).toBe(1500);
    expect(capturedSilence?.onSilence).toBeTypeOf("function");

    // 模拟录音器检测到静音，触发 onSilence → 自动 stop + 转写
    await act(async () => {
      capturedSilence?.onSilence?.();
      await Promise.resolve();
    });
    expect(recorder.stopMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onTranscribed).toHaveBeenCalledWith("自动识别的内容");
    expect(result.current.phase).toBe("idle");
  });

  it("非对话感模式：不传静音配置", async () => {
    let capturedSilence: { silenceTimeoutMs?: number } | undefined;
    const recorder = fakeRecorder();
    const { result } = renderHook(() =>
      useVoiceInput({
        onTranscribed: vi.fn(),
        onError: vi.fn(),
        createRecorder: (opts) => {
          capturedSilence = opts;
          return recorder;
        },
        transcribe: vi.fn(async () => ""),
      })
    );
    await act(async () => {
      await result.current.start();
    });
    expect(capturedSilence?.silenceTimeoutMs).toBeUndefined();
  });
});
