import { describe, expect, it } from "vitest";
import { floatSamplesToInt16Pcm } from "./recorder";

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
