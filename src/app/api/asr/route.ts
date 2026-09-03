import { NextRequest } from "next/server";
import { AsrError, createDefaultAsrClient } from "@/lib/asr-client";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB，浏览器单段录音远小于此

/**
 * POST /api/asr（multipart：audio 文件）
 * 语音识别：浏览器录音（m4a）→ 讯飞语音转写 → { text }
 * 无状态、无存储：音频不落库，只返回文本。
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "请求格式错误" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "缺少音频内容" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "音频过大（超过 20MB）" }, { status: 400 });
  }

  let client;
  try {
    client = createDefaultAsrClient();
  } catch (err) {
    console.error("asr: client init failed", err);
    return Response.json({ error: "服务端未配置语音识别（XFYUN）" }, { status: 500 });
  }

  try {
    const text = await client.transcribe(audio);
    return Response.json({ text });
  } catch (err) {
    if (err instanceof AsrError) {
      // 语义化错误码对前端可做区分（如 no_quota 提示领取额度）
      return Response.json({ error: err.message, code: err.code }, { status: 502 });
    }
    console.error("asr: transcribe failed", err);
    return Response.json({ error: "识别服务异常，请重试" }, { status: 502 });
  }
}
