// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AsrError,
  XfyunIatClient,
  buildIatAuthorization,
  buildIatFrame,
  buildIatWsUrl,
  createDefaultAsrClient,
  extractIatText,
  type AsrClient,
  type WsLike,
} from "./asr-client";

const CRED = { appId: "app-1", apiKey: "k-123", apiSecret: "testsecret123" };
const DATE = "Wed, 10 Jul 2019 07:35:43 GMT";

describe("buildIatAuthorization / buildIatWsUrl（iat v2 鉴权）", () => {
  it("authorization 解码后含 api_key/algorithm/headers 与预计算签名真值", () => {
    const auth = buildIatAuthorization(CRED, "iat-api.xfyun.cn", "/v2/iat", DATE);
    const decoded = Buffer.from(auth, "base64").toString("utf8");
    expect(decoded).toContain('api_key="k-123"');
    expect(decoded).toContain('algorithm="hmac-sha256"');
    expect(decoded).toContain('headers="host date request-line"');
    // 签名真值由 node crypto 预计算（独立来源，非代码同式重算）
    expect(decoded).toContain('signature="VlfZjeY9dhy8v61kM7MrGQxj6oP/5Z2+8nuW6zc56IQ="');
  });

  it("URL 含编码后的 authorization/date/host 参数", () => {
    const url = buildIatWsUrl(CRED, { date: DATE });
    expect(url).toMatch(/^wss:\/\/iat-api\.xfyun\.cn\/v2\/iat\?/);
    const params = new URL(url).searchParams;
    expect(params.get("authorization")).toBeTruthy();
    expect(params.get("date")).toBe(DATE);
    expect(params.get("host")).toBe("iat-api.xfyun.cn");
  });
});

describe("buildIatFrame（帧构造）", () => {
  it("首帧含 common/business 与音频参数", () => {
    const frame = JSON.parse(
      buildIatFrame({ appId: "app-1", status: 0, audioB64: "QUJD" })
    ) as Record<string, unknown>;
    expect(frame.common).toEqual({ app_id: "app-1" });
    expect((frame.business as Record<string, unknown>).language).toBe("zh_cn");
    expect((frame.data as Record<string, unknown>).status).toBe(0);
    expect((frame.data as Record<string, unknown>).audio).toBe("QUJD");
    expect((frame.data as Record<string, unknown>).format).toBe("audio/L16;rate=16000");
  });

  it("中间/尾帧不再带 common 与音频", () => {
    const tail = JSON.parse(buildIatFrame({ appId: "app-1", status: 2 })) as Record<
      string,
      unknown
    >;
    expect(tail.common).toBeUndefined();
    expect((tail.data as Record<string, unknown>).status).toBe(2);
    expect((tail.data as Record<string, unknown>).audio).toBeUndefined();
  });
});

describe("extractIatText（result 帧解析）", () => {
  it("拼接 ws[].cw[].w 为文本", () => {
    const frame = {
      code: 0,
      data: {
        result: {
          ws: [{ cw: [{ w: "我叫" }, { w: "张三" }] }, { cw: [{ w: "负责推荐系统" }] }],
        },
        status: 2,
      },
    };
    expect(extractIatText(frame)).toBe("我叫张三负责推荐系统");
  });

  it("结构异常返回空串", () => {
    expect(extractIatText({})).toBe("");
    expect(extractIatText(null)).toBe("");
  });
});

describe("XfyunIatClient.transcribe（注入 fake WebSocket）", () => {
  class FakeWs implements WsLike {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onclose: ((ev: { code?: number }) => void) | null = null;
    sent: string[] = [];
    closeMock = vi.fn();
    send(m: string) {
      this.sent.push(m);
    }
    close() {
      this.closeMock();
    }
  }

  let ws: FakeWs;
  let wsCtor: new (url: string) => WsLike;

  function makeFakeWs() {
    ws = new FakeWs();
    // 每次 new 都返回同一实例，测试直接触发 ws 上的事件
    wsCtor = class extends FakeWs {
      constructor(_url: string) {
        super();
        return ws;
      }
    };
  }

  function client(overrides: { timeoutMs?: number } = {}) {
    return new XfyunIatClient({ ...CRED, wsCtor, timeoutMs: overrides.timeoutMs ?? 30_000 });
  }

  beforeEach(() => {
    makeFakeWs();
  });

  it("连接后按序发送首帧(status0)→尾帧(status2)，收到 status2 结果返回文本", async () => {
    const c = client();
    const p = c.transcribe(new Blob([new Uint8Array(2000)], { type: "audio/pcm" }));
    await new Promise((r) => setTimeout(r, 0));
    ws.onopen?.();
    await new Promise((r) => setTimeout(r, 0));
    // 2000B < 40KB → 一帧音频 + 尾帧
    expect(ws.sent).toHaveLength(2);
    const first = JSON.parse(ws.sent[0]) as { data: { status: number } };
    expect(first.data.status).toBe(0);
    const tail = JSON.parse(ws.sent[1]) as { data: { status: number } };
    expect(tail.data.status).toBe(2);

    ws.onmessage?.({
      data: JSON.stringify({
        code: 0,
        data: { status: 2, result: { ws: [{ cw: [{ w: "识别出的回答" }] }] } },
      }),
    });
    await expect(p).resolves.toBe("识别出的回答");
  });

  it("超过单帧大小会分帧发送（中间帧 status1）", async () => {
    const c = client();
    // 100KB 音频 → 3 帧数据（40KB×2 + 20KB）+ 尾帧
    const p = c.transcribe(new Blob([new Uint8Array(100 * 1024)], { type: "audio/pcm" }));
    await new Promise((r) => setTimeout(r, 0));
    ws.onopen?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(ws.sent).toHaveLength(4);
    expect(JSON.parse(ws.sent[0]).data.status).toBe(0);
    expect(JSON.parse(ws.sent[1]).data.status).toBe(1);
    expect(JSON.parse(ws.sent[2]).data.status).toBe(1);
    expect(JSON.parse(ws.sent[3]).data.status).toBe(2);
    ws.onmessage?.({
      data: JSON.stringify({
        code: 0,
        data: { status: 2, result: { ws: [{ cw: [{ w: "ok" }] }] } },
      }),
    });
    await p;
  });

  it("服务端 error（code!=0）→ AsrError(failed)", async () => {
    const c = client();
    const p = c.transcribe(new Blob([new Uint8Array(10)], { type: "audio/pcm" }));
    await new Promise((r) => setTimeout(r, 0));
    ws.onopen?.();
    await new Promise((r) => setTimeout(r, 0));
    ws.onmessage?.({ data: JSON.stringify({ code: 11200, message: "引擎未授权" }) });
    await expect(p).rejects.toMatchObject({ name: "AsrError", code: "failed" });
  });

  it("status2 无文本 → AsrError(empty)", async () => {
    const c = client();
    const p = c.transcribe(new Blob([new Uint8Array(10)], { type: "audio/pcm" }));
    await new Promise((r) => setTimeout(r, 0));
    ws.onopen?.();
    await new Promise((r) => setTimeout(r, 0));
    ws.onmessage?.({
      data: JSON.stringify({ code: 0, data: { status: 2, result: { ws: [{ cw: [{ w: "" }] }] } } }),
    });
    await expect(p).rejects.toMatchObject({ name: "AsrError", code: "empty" });
  });

  it("连接错误 → AsrError(network)", async () => {
    const c = client();
    const p = c.transcribe(new Blob([new Uint8Array(10)], { type: "audio/pcm" }));
    await Promise.resolve();
    ws.onerror?.({});
    await expect(p).rejects.toMatchObject({ name: "AsrError", code: "network" });
  });

  it("超时 → AsrError(timeout)", async () => {
    vi.useFakeTimers();
    const c = client({ timeoutMs: 5000 });
    const p = c.transcribe(new Blob([new Uint8Array(10)], { type: "audio/pcm" }));
    await Promise.resolve();
    vi.advanceTimersByTime(5001);
    await expect(p).rejects.toMatchObject({ name: "AsrError", code: "timeout" });
    vi.useRealTimers();
  });
});

describe("createDefaultAsrClient", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("缺环境变量抛错提示配置", () => {
    vi.stubEnv("XFYUN_API_KEY", "");
    expect(() => createDefaultAsrClient()).toThrow(/XFYUN/);
  });

  it("配置齐全返回 XfyunIatClient", () => {
    vi.stubEnv("XFYUN_APP_ID", "a");
    vi.stubEnv("XFYUN_API_KEY", "k");
    vi.stubEnv("XFYUN_API_SECRET", "s");
    const client: AsrClient = createDefaultAsrClient();
    expect(client).toBeInstanceOf(XfyunIatClient);
  });
});
