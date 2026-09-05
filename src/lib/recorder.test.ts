import { describe, expect, it, vi } from "vitest";
import { computeRms, createSilenceDetector, floatSamplesToInt16Pcm } from "./recorder";

describe("floatSamplesToInt16Pcm", () => {
  it("把 Float32 采样转为 16bit 小端 PCM", () => {
    const out = floatSamplesToInt16Pcm(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(16384); // 0.5 * 0x7fff ≈ 16383.5 → round 16384
    expect(view.getInt16(4, true)).toBe(-16384);
    expect(view.getInt16(6, true)).toBe(32767);
    expect(view.getInt16(8, true)).toBe(-32768);
    expect(out.byteLength).toBe(5 * 2);
  });

  it("越界采样被夹到 [-1, 1]", () => {
    const out = floatSamplesToInt16Pcm(new Float32Array([1.5, -2]));
    const view = new DataView(out);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});

describe("computeRms（音量计算）", () => {
  it("静音为 0", () => {
    expect(computeRms(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("恒定振幅返回该振幅", () => {
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 5);
  });

  it("空数组为 0", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });
});

describe("createSilenceDetector（静音检测）", () => {
  it("连续静音达到阈值触发一次 onSilence", () => {
    const onSilence = vi.fn();
    const det = createSilenceDetector({ sampleRate: 1000, silenceTimeoutMs: 1500, onSilence });
    // 采样率 1000，静音 1.5s = 1500 个采样；分 3 块喂，每块 500 个静音采样
    const silent = new Float32Array(500); // 全 0 = 静音
    expect(det.push(silent)).toBe(false);
    expect(det.push(silent)).toBe(false);
    expect(det.push(silent)).toBe(true); // 第 3 块达到 1500 采样 → 触发
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("中间有声音会重置静音累积", () => {
    const onSilence = vi.fn();
    const det = createSilenceDetector({ sampleRate: 1000, silenceTimeoutMs: 1500, onSilence });
    const silent = new Float32Array(500);
    const loud = new Float32Array(500).fill(0.5); // 有声音
    det.push(silent); // 静音 500
    det.push(loud); // 有声音 → 重置
    det.push(silent); // 静音 500
    det.push(silent); // 静音 500（累计 1000，未到 1500）
    expect(onSilence).not.toHaveBeenCalled();
    det.push(silent); // 静音 500 → 累计 1500 → 触发
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("reset 清零累积", () => {
    const onSilence = vi.fn();
    const det = createSilenceDetector({ sampleRate: 1000, silenceTimeoutMs: 1500, onSilence });
    const silent = new Float32Array(500);
    det.push(silent);
    det.push(silent);
    det.reset();
    det.push(silent);
    det.push(silent);
    expect(onSilence).not.toHaveBeenCalled(); // reset 后重新累积，未到阈值
  });
});
