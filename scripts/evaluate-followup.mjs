// 追问策略离线评测：测面试官追问是否"锚定上一轮回答" + "节奏是否合理"。
// 用法：node scripts/evaluate-followup.mjs   （需 dev server 运行在 localhost:3000）
// 省 token：只调 /api/chat 要"下一句"这一句话，不跑完整报告。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3000";
const CORPUS = join(__dirname, "..", "evaluation", "followup-corpus.json");
const RUNS = 1; // 每条样本跑几次（省 token 默认 1，需要稳定性可调大）

/** 调 /api/chat，返回面试官下一句完整文本 */
async function nextQuestion(sample) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: sample.resume,
      messages: sample.history,
      questionCount: 10,
      userMessage: "", // 历史里已含本轮回答，这里不再追加
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`chat failed for ${sample.id}: ${res.status} ${t.slice(0, 120)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "text") full += evt.delta;
      } catch {
        /* ignore partial */
      }
    }
  }
  return full.trim();
}

/** 指标① 锚定率：下一句是否引用了上一轮回答里的任一关键词 */
function isAnchored(question, keywords) {
  return keywords.some((k) => question.includes(k));
}

/** 指标② 节奏合理性：good 样本应收尾转话题（不追问），vague 样本应追问 */
function isReasonable(question, quality) {
  if (quality === "good") {
    // 答得好：应该收尾。判定"收尾"= 句子以转话题/认可为主，而非对旧点继续追问。
    // 简单代理：good 样本的下一句不应继续引用原回答关键词（引用了说明还在追问旧点）
    return true; // 收尾与否依赖关键词之外，这里用"非锚定"作为代理，单独在统计里体现
  }
  // vague 样本：应该追问 → 应引用关键词
  return true;
}

async function main() {
  const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
  console.log(`══ 追问策略评测（样本 ${corpus.length} 条）══\n`);

  const rows = [];
  for (const sample of corpus) {
    const questions = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        questions.push(await nextQuestion(sample));
      } catch (e) {
        console.log(`  ${sample.id} ❌ ${e.message}`);
      }
    }
    if (questions.length === 0) continue;
    const q = questions[0];
    const anchored = isAnchored(q, sample.keywords);
    rows.push({ id: sample.id, quality: sample.quality, question: q, anchored });
    console.log(`  [${sample.quality === "good" ? "好" : "含糊"}] ${sample.id}`);
    console.log(`     回答: ${sample.history[sample.history.length - 1].content.slice(0, 40)}`);
    console.log(`     下一问: ${q.slice(0, 60)}`);
    console.log(`     锚定关键词: ${anchored ? "✅ 是" : "➖ 否"}`);
  }

  // 统计
  const good = rows.filter((r) => r.quality === "good");
  const vague = rows.filter((r) => r.quality === "vague");

  const goodAnchored = good.filter((r) => r.anchored).length;
  const vagueAnchored = vague.filter((r) => r.anchored).length;

  console.log(`\n════ 结果 ════`);
  console.log(`指标① 追问锚定率（下一问引用上一轮回答关键词）:`);
  console.log(`  good 样本（答得好）: ${good.length ? Math.round((goodAnchored / good.length) * 100) : 0}%  （期望：低，答得好应收尾不追）`);
  console.log(`  vague 样本（答得含糊）: ${vague.length ? Math.round((vagueAnchored / vague.length) * 100) : 0}%  （期望：高，答得含糊应追问）`);

  // 落盘
  const outdir = join(__dirname, "..", "evaluation", "results");
  mkdirSync(outdir, { recursive: true });
  const outfile = join(outdir, `followup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    outfile,
    JSON.stringify(
      {
        goodAnchoredRate: good.length ? goodAnchored / good.length : 0,
        vagueAnchoredRate: vague.length ? vagueAnchored / vague.length : 0,
        rows,
      },
      null,
      2
    )
  );
  console.log(`\n已落盘: ${outfile}`);
}

main().catch((e) => {
  console.error("评测失败:", e.message ?? e);
  process.exit(1);
});
