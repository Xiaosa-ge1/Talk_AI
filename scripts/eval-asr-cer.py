# -*- coding: utf-8 -*-
"""
语音识别准确率评测（CER 字错率）。

流程：
1. 读标准语料 asr-corpus.json（含短句/长句，长句专门覆盖"分帧丢内容"bug）
2. 用 edge-tts 把每条文本转成音频，再转 16k 16bit 单声道 PCM（讯飞 iat 要求）
3. 把 PCM 喂给 /api/asr，拿识别文本
4. 算 CER（字符错误率）：(替换+删除+插入) / 标准文本字数
5. 输出每条 CER + 平均 CER，落盘结果 JSON 供前后对比

依赖：dev server 运行中（http://localhost:3000），环境变量里的讯飞凭据由服务端读取。
用法：
  python eval-asr-cer.py            # 跑全部语料
  python eval-asr-cer.py --limit 3  # 只跑前 3 条（冒烟）
"""

import asyncio
import io
import json
import os
import sys
import time
import urllib.request
import edge_tts
import numpy as np
import soundfile as sf

BASE = "http://localhost:3000"
# 语料与结果都落在项目 evaluation 目录（脚本位于 scripts/，向上找项目根）
PROJECT_EVAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evaluation")
CORPUS = os.path.join(PROJECT_EVAL, "asr-corpus.json")
VOICE = "zh-CN-XiaoxiaoNeural"
TARGET_RATE = 16000


def tts_to_pcm(text: str) -> bytes:
    """edge-tts 生成音频 → 重采样到 16k → 16bit 单声道 PCM 字节"""
    async def run():
        tts = edge_tts.Communicate(text, voice=VOICE)
        mp3 = b""
        async for chunk in tts.stream():
            if chunk["type"] == "audio":
                mp3 += chunk["data"]
        return mp3

    mp3 = asyncio.run(run())
    data, sr = sf.read(io.BytesIO(mp3))
    if data.ndim > 1:
        data = data[:, 0]
    # 重采样到 16k
    if sr != TARGET_RATE:
        n = int(len(data) * TARGET_RATE / sr)
        data = np.interp(np.linspace(0, len(data) - 1, n), np.arange(len(data)), data)
    # 转 16bit PCM
    pcm = (np.clip(data, -1, 1) * 32767).astype(np.int16)
    return pcm.tobytes()


def transcribe(pcm: bytes) -> str:
    """POST /api/asr，返回识别文本；失败抛异常"""
    boundary = "----evalboundary"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="audio"; filename="a.pcm"\r\n'
        "Content-Type: audio/pcm\r\n\r\n"
    ).encode() + pcm + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{BASE}/api/asr",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
    if "text" in resp:
        return resp["text"]
    raise RuntimeError(f"识别失败: {resp}")


def norm(s: str) -> str:
    """去掉标点/空白，便于逐字比对"""
    import re
    return re.sub(r"[\s，。！？、；：""''（）《》【】,.!?;:()\"\']", "", s)


def cer(ref: str, hyp: str) -> float:
    """字符错误率（编辑距离 / 参考长度）"""
    ref, hyp = norm(ref), norm(hyp)
    if not ref:
        return 0.0
    # DP 编辑距离
    m, n = len(ref), len(hyp)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[m][n] / m


def main():
    limit_arg = [a for a in sys.argv if a.startswith("--limit=")]
    limit = int(limit_arg[0].split("=")[1]) if limit_arg else None

    with open(CORPUS, encoding="utf8") as f:
        corpus = json.load(f)
    if limit:
        corpus = corpus[:limit]

    print(f"══ 语音识别 CER 评测（语料 {len(corpus)} 条）══\n")
    results = []
    for i, item in enumerate(corpus, 1):
        t0 = time.time()
        try:
            pcm = tts_to_pcm(item["text"])
            hyp = transcribe(pcm)
            err = cer(item["text"], hyp)
            tag = "✅" if err < 0.2 else ("⚠️" if err < 0.4 else "❌")
            results.append({"id": item["id"], "ref": item["text"], "hyp": hyp, "cer": round(err, 4)})
            print(f"[{i}/{len(corpus)}] {tag} {item['id']} CER={err:.1%}  ({time.time()-t0:.1f}s)")
            print(f"    原文: {item['text'][:40]}")
            print(f"    识别: {hyp[:40]}")
        except Exception as e:
            results.append({"id": item["id"], "ref": item["text"], "hyp": None, "cer": None, "error": str(e)})
            print(f"[{i}/{len(corpus)}] ❌ {item['id']} 失败: {e}")

    ok = [r for r in results if r.get("cer") is not None]
    avg = sum(r["cer"] for r in ok) / len(ok) if ok else 0
    print(f"\n════ 结果 ════")
    print(f"成功 {len(ok)}/{len(results)} 条")
    print(f"平均 CER: {avg:.1%}（越低越好，0=完全正确）")

    # 按长短分组看
    long_ok = [r for r in ok if r["id"].startswith("long")]
    short_ok = [r for r in ok if not r["id"].startswith("long")]
    if long_ok:
        print(f"长句平均 CER: {sum(r['cer'] for r in long_ok)/len(long_ok):.1%}")
    if short_ok:
        print(f"短句平均 CER: {sum(r['cer'] for r in short_ok)/len(short_ok):.1%}")

    # 落盘
    out = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "avgCer": round(avg, 4),
        "results": results,
    }
    outdir = os.path.join(PROJECT_EVAL, "results")
    os.makedirs(outdir, exist_ok=True)
    outfile = os.path.join(outdir, f"asr-cer-{time.strftime('%Y%m%dT%H%M%S')}.json")
    with open(outfile, "w", encoding="utf8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n已落盘: {outfile}")


if __name__ == "__main__":
    main()
