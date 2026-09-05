import { createHmac } from "node:crypto";

/**
 * 语音识别客户端 —— 讯飞「语音听写（流式版）」iat v2（WebSocket）。
 *
 * 设计（与 deepseek.ts 同构的可注入接口）：
 * - AsrClient 窄接口，测试注入 fake WebSocket / fake client
 * - 鉴权 URL 组装与结果解析是纯函数（可单测，不碰网络）
 * - key 只从服务端环境变量读取（AGENTS 密钥红线）
 *
 * 协议要点（讯飞语音听写流式版文档）：
 * - 端点 wss://iat-api.xfyun.cn/v2/iat
 * - 鉴权：URL query 带 authorization（base64(api_key=…, hmac-sha256, host date request-line)）、date（RFC1123 GMT）、host
 * - 音频：16k/8k 16bit 单声道 pcm（raw），最长 60s
 * - 帧：首帧 {common:{app_id},business:{…},data:{status:0,audio:b64}} → 中间帧 status:1 → 尾帧 {data:{status:2}}
 */

export type AsrErrorCode = "empty" | "no_quota" | "failed" | "invalid" | "timeout" | "network";

export class AsrError extends Error {
  code: AsrErrorCode;
  constructor(code: AsrErrorCode, message: string) {
    super(message);
    this.name = "AsrError";
    this.code = code;
  }
}

export interface AsrClient {
  /** 识别一段 16k 16bit 单声道 pcm 录音，返回文本（失败抛 AsrError） */
  transcribe(audio: Blob): Promise<string>;
}

export const IAT_HOST = "iat-api.xfyun.cn";
export const IAT_PATH = "/v2/iat";
/** 单帧音频字节数（16k pcm = 2B/采样，40KB ≈ 1.25s），防止单帧过大被服务端拒 */
const FRAME_BYTES = 40 * 1024;

interface IatCredentials {
  appId: string;
  apiKey: string;
  apiSecret: string;
}

/** 生成 authorization 参数（base64(api_key=…,algorithm=…,headers=…,signature=…)） */
export function buildIatAuthorization(
  cred: IatCredentials,
  host: string,
  path: string,
  date: string
): string {
  const origin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
  const signature = createHmac("sha256", cred.apiSecret).update(origin).digest("base64");
  const authorizationOrigin = `api_key="${cred.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  return Buffer.from(authorizationOrigin, "utf8").toString("base64");
}

/** 组装带鉴权参数的 WebSocket URL（date 需 RFC1123 GMT，时钟偏移 ≤300s） */
export function buildIatWsUrl(
  cred: IatCredentials,
  opts?: { host?: string; path?: string; date?: string }
): string {
  const host = opts?.host ?? IAT_HOST;
  const path = opts?.path ?? IAT_PATH;
  const date = opts?.date ?? new Date().toUTCString();
  const authorization = buildIatAuthorization(cred, host, path, date);
  const qs = new URLSearchParams({ authorization, date, host });
  return `wss://${host}${path}?${qs.toString()}`;
}

/** 从 result 帧提取文本（data.result.ws[].cw[].w 拼接） */
export function extractIatText(frame: unknown): string {
  if (!frame || typeof frame !== "object") return "";
  const f = frame as { data?: { result?: { ws?: Array<{ cw?: Array<{ w?: unknown }> }> } } };
  const ws = f.data?.result?.ws;
  if (!Array.isArray(ws)) return "";
  return ws
    .flatMap((seg) => seg.cw ?? [])
    .map((c) => (typeof c.w === "string" ? c.w : ""))
    .join("");
}

/** 构造发送帧（首帧带 common+business；中间/尾帧也必须带 common.app_id，否则服务端会丢帧） */
export function buildIatFrame(params: {
  appId: string;
  status: 0 | 1 | 2;
  audioB64?: string;
}): string {
  const data: Record<string, unknown> = { status: params.status };
  if (params.audioB64 !== undefined) {
    data.format = "audio/L16;rate=16000";
    data.encoding = "raw";
    data.audio = params.audioB64;
  }
  // common.app_id 每一帧都必须带（讯飞 iat v2 协议：中间帧/尾帧缺 app_id 会被丢弃）
  const frame: Record<string, unknown> = {
    common: { app_id: params.appId },
    data,
  };
  // business 只需在首帧携带（后续帧可省）
  if (params.status === 0) {
    frame.business = { language: "zh_cn", domain: "iat", accent: "mandarin", ptt: 1 };
  }
  return JSON.stringify(frame);
}

/** 可注入的 WebSocket 构造器类型（测试用 fake） */
type WsCtor = new (url: string) => WsLike;
export interface WsLike {
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
}

export class XfyunIatClient implements AsrClient {
  private readonly cred: IatCredentials;
  private readonly wsCtor: WsCtor;
  private readonly timeoutMs: number;

  constructor(options: IatCredentials & { wsCtor?: WsCtor; timeoutMs?: number }) {
    this.cred = { appId: options.appId, apiKey: options.apiKey, apiSecret: options.apiSecret };
    this.wsCtor = options.wsCtor ?? (WebSocket as unknown as WsCtor);
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async transcribe(audio: Blob): Promise<string> {
    const url = buildIatWsUrl(this.cred);
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (err: AsrError | null, text?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(text ?? "");
        try {
          ws.close();
        } catch {
          // ignore
        }
      };

      const ws = new this.wsCtor(url);
      const timer = setTimeout(
        () => finish(new AsrError("timeout", "识别超时，请重试")),
        this.timeoutMs
      );

      ws.onerror = () => finish(new AsrError("network", "语音识别连接失败，请重试"));
      ws.onclose = () => {
        if (!settled) finish(new AsrError("network", "语音识别连接中断，请重试"));
      };

      ws.onopen = () => {
        void (async () => {
          const bytes = new Uint8Array(await audio.arrayBuffer());
          if (bytes.length === 0) {
            finish(new AsrError("empty", "没有录音内容"));
            return;
          }
          // 逐帧发送：首帧 status0 → 中间 status1 → 尾帧 status2。
          // 每一帧（含中间帧/尾帧）都必须带 common.app_id（见 buildIatFrame），
          // 否则服务端会丢弃缺 app_id 的帧。
          for (let offset = 0; offset < bytes.length; offset += FRAME_BYTES) {
            const chunk = bytes.subarray(offset, Math.min(offset + FRAME_BYTES, bytes.length));
            const b64 = Buffer.from(chunk).toString("base64");
            const isFirst = offset === 0;
            ws.send(
              buildIatFrame({ appId: this.cred.appId, status: isFirst ? 0 : 1, audioB64: b64 })
            );
          }
          ws.send(buildIatFrame({ appId: this.cred.appId, status: 2 }));
        })().catch(() => finish(new AsrError("failed", "音频处理失败")));
      };

      // 累积所有返回帧的识别文本（讯飞流式会分多帧返回：status=0/1 中间结果 + status=2 最终结果，
      // 只取 status=2 会丢掉前面一大段，导致长句只剩后半句）
      let fullText = "";
      ws.onmessage = (ev) => {
        let frame: { code?: unknown; message?: unknown; data?: { status?: unknown } };
        try {
          frame = JSON.parse(String(ev.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.code !== undefined && frame.code !== 0) {
          finish(
            new AsrError("failed", typeof frame.message === "string" ? frame.message : "识别失败")
          );
          return;
        }
        fullText += extractIatText(frame);
        if (frame.data?.status === 2) {
          const trimmed = fullText.trim();
          if (!trimmed) finish(new AsrError("empty", "没有识别到语音内容，请再说一遍"));
          else finish(null, trimmed);
        }
      };
    });
  }
}

/** 默认客户端工厂：从服务端环境变量读取讯飞语音听写凭据 */
export function createDefaultAsrClient(): AsrClient {
  const appId = process.env.XFYUN_APP_ID;
  const apiKey = process.env.XFYUN_API_KEY;
  const apiSecret = process.env.XFYUN_API_SECRET;
  if (!appId || !apiKey || !apiSecret) {
    throw new Error(
      "XFYUN_APP_ID / XFYUN_API_KEY / XFYUN_API_SECRET 未配置：请在 .env.local 设置（讯飞语音听写流式版）"
    );
  }
  return new XfyunIatClient({ appId, apiKey, apiSecret });
}
