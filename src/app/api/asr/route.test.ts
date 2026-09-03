// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AsrClient } from "@/lib/asr-client";

// mock 工厂：保留真实 AsrError/类；默认客户端工厂模拟真实逻辑（读 env，缺配置抛错）
vi.mock("@/lib/asr-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/asr-client")>();
  const mockTranscribe = vi.fn<AsrClient["transcribe"]>();
  return {
    ...actual,
    createDefaultAsrClient: (): AsrClient => {
      if (
        !process.env.XFYUN_APP_ID ||
        !process.env.XFYUN_API_KEY ||
        !process.env.XFYUN_API_SECRET
      ) {
        throw new Error("XFYUN_* 未配置");
      }
      return { transcribe: mockTranscribe };
    },
    __mockTranscribe: mockTranscribe,
  };
});

const asrModule = (await import("@/lib/asr-client")) as unknown as {
  __mockTranscribe: ReturnType<typeof vi.fn>;
  AsrError: typeof import("@/lib/asr-client").AsrError;
};
const mockTranscribe = asrModule.__mockTranscribe;
const { POST } = await import("./route");

async function fakeAudioRequest(content: string): Promise<NextRequest> {
  const form = new FormData();
  form.append("audio", new Blob([content], { type: "audio/mp4" }), "answer.m4a");
  return new NextRequest("http://localhost/api/asr", { method: "POST", body: form });
}

beforeEach(() => {
  vi.stubEnv("XFYUN_APP_ID", "app-1");
  vi.stubEnv("XFYUN_API_KEY", "k-1");
  vi.stubEnv("XFYUN_API_SECRET", "s-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  mockTranscribe.mockReset();
});

describe("POST /api/asr", () => {
  it("识别成功返回文本", async () => {
    mockTranscribe.mockResolvedValue("我叫张三，负责推荐系统改版");
    const res = await POST(await fakeAudioRequest("fake"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe("我叫张三，负责推荐系统改版");
    // 传给 client 的是音频 Blob
    expect(mockTranscribe).toHaveBeenCalledTimes(1);
    const audioArg = mockTranscribe.mock.calls[0][0] as Blob;
    expect(audioArg.size).toBeGreaterThan(0);
  });

  it("缺少音频返回 400", async () => {
    const form = new FormData();
    const res = await POST(
      new NextRequest("http://localhost/api/asr", { method: "POST", body: form })
    );
    expect(res.status).toBe(400);
    expect(mockTranscribe).not.toHaveBeenCalled();
  });

  it("未配置凭据返回 500", async () => {
    vi.stubEnv("XFYUN_APP_ID", "");
    const res = await POST(await fakeAudioRequest("x"));
    expect(res.status).toBe(500);
  });

  it("识别失败（AsrError）返回 502 与语义错误码", async () => {
    mockTranscribe.mockRejectedValue(new asrModule.AsrError("no_quota", "服务时长不足"));
    const res = await POST(await fakeAudioRequest("x"));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("no_quota");
  });

  it("未知异常也返回 502 而非 500 崩溃", async () => {
    mockTranscribe.mockRejectedValue(new Error("boom"));
    const res = await POST(await fakeAudioRequest("x"));
    expect(res.status).toBe(502);
  });
});
