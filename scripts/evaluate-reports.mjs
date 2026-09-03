/**
 * 评测准确性诊断工具（跑分脚本）
 * 用途：对 golden set 每条样本调用 /api/report，输出三个测试的结果：
 *   1. 稳定性：同一样本生成 N 次，维度分差多大（越小越稳）
 *   2. 区分度：强档 vs 弱档每维均分差（越大越能分开好坏）
 *   3. 客观指标相关性：样本里"出现数字的次数"与"数据思维分"排序是否一致
 *
 * 依赖：本地 dev server 运行中（http://localhost:3000）
 * 用法：node scripts/evaluate-reports.mjs [--runs 2]
 * 注意：会真实消耗 LLM token（9 条 × runs 次报告生成），改造 prompt 前后各跑一次对比。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? parseInt(runsArg.split("=")[1], 10) : 2;
const BASE_URL = "http://localhost:3000";
const goldenPath = path.join(__dirname, "..", "evaluation", "golden-set", "golden-set.json");
const { samples } = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

async function generateReport(sample) {
  const res = await fetch(`${BASE_URL}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: sample.resume,
      messages: sample.messages,
      questionCount: sample.questionCount,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`report failed for ${sample.id}: ${res.status} ${text.slice(0, 200)}`);
  }
  // SSE 流式：累积 text 事件，取 done 事件的 report
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report = null;
  let errorMsg = null;
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
        if (evt.type === "done") report = evt.report;
        if (evt.type === "error") errorMsg = evt.message;
      } catch {
        // ignore partial
      }
    }
  }
  if (!report) throw new Error(`no report for ${sample.id}: ${errorMsg ?? "unknown"}`);
  return report;
}

/** 统计样本中用户回答出现阿拉伯数字的次数（客观指标） */
function countDigits(sample) {
  const userText = sample.messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
  const matches = userText.match(/\d+(\.\d+)?%?/g);
  return matches ? matches.length : 0;
}

/** 统计样本用户回答的平均长度（字） */
function avgAnswerLength(sample) {
  const users = sample.messages.filter((m) => m.role === "user");
  if (users.length === 0) return 0;
  return Math.round(users.reduce((s, m) => s + m.content.length, 0) / users.length);
}

async function main() {
  console.log(`══ 评测准确性诊断（golden set: ${samples.length} 条, 每条跑 ${RUNS} 次）══\n`);

  const results = [];
  const failed = [];
  for (const sample of samples) {
    const reports = [];
    let ok = true;
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await generateReport(sample);
        reports.push(r);
        console.log(`  [${i + 1}/${RUNS}] ${sample.id} (${sample.level}) done`);
      } catch (err) {
        ok = false;
        console.log(`  [${i + 1}/${RUNS}] ${sample.id} (${sample.level}) ❌ ${err.message}`);
      }
    }
    if (ok) {
      results.push({ sample, reports });
    } else {
      failed.push({ id: sample.id, level: sample.level });
    }
  }

  if (failed.length > 0) {
    console.log(`\n⚠️ ${failed.length} 条样本有失败轮次，已跳过（它们本身也是评测不稳定的证据）`);
  }

  const dimKeys = ["logic", "depth", "data", "agility"];
  const dimLabels = { logic: "表达逻辑", depth: "专业深度", data: "数据思维", agility: "应变能力" };

  // ── 1. 稳定性：同一样本各维度两次分差的均值 ──
  console.log(`\n── 测试 1: 稳定性（同样本 ${RUNS} 次生成，每维分差）──`);
  console.log("判定：5 分制下平均分差 ≤0.5 为稳；>1 为不稳\n");
  console.log("样本".padEnd(24) + dimKeys.map((k) => dimLabels[k]).join("  "));
  let stabilitySum = 0;
  let stabilityCount = 0;
  for (const { sample, reports } of results) {
    const diffs = dimKeys.map((k) => {
      const vals = reports.map((r) => {
        const d = r.dimensions.find((x) => x.key === k);
        return d ? d.score : null;
      });
      const valid = vals.filter((v) => v !== null);
      if (valid.length < 2) return 0;
      return Math.abs(valid[0] - valid[1]);
    });
    const row = sample.id.padEnd(24) + dimKeys.map((k, i) => `${diffs[i].toFixed(1)}`).join("  ");
    console.log(row);
    diffs.forEach((d) => {
      stabilitySum += d;
      stabilityCount += 1;
    });
  }
  const avgDiff = stabilitySum / stabilityCount;
  console.log(`\n平均分差: ${avgDiff.toFixed(2)} ${avgDiff <= 0.5 ? "✅ 稳" : avgDiff <= 1 ? "⚠️ 一般" : "❌ 不稳"}\n`);

  // ── 2. 区分度：强档 vs 弱档每维均分差 ──
  console.log("── 测试 2: 区分度（strong 均分 - weak 均分，每维）──");
  console.log("判定：强档每维均分比弱档高 ≥1 分算能分开好坏\n");
  const group = { strong: [], mid: [], weak: [] };
  for (const { sample, reports } of results) {
    const avg = dimKeys.map((k) => {
      const vals = reports.map((r) => {
        const d = r.dimensions.find((x) => x.key === k);
        return d ? d.score : null;
      }).filter((v) => v !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });
    group[sample.level].push(avg);
  }
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a.map((v, i) => v + b[i]), arr[0]) : null);
  const meanOf = (list) => {
    const summed = mean(list);
    return summed ? summed.map((v) => v / list.length) : null;
  };
  const strongMean = meanOf(group.strong);
  const weakMean = meanOf(group.weak);
  console.log("维度".padEnd(10) + "强档均分".padEnd(10) + "弱档均分".padEnd(10) + "分差");
  if (strongMean && weakMean) {
    dimKeys.forEach((k, i) => {
      const diff = strongMean[i] - weakMean[i];
      const mark = diff >= 1 ? "✅" : diff >= 0.5 ? "⚠️" : "❌";
      console.log(
        dimLabels[k].padEnd(10) +
          strongMean[i].toFixed(1).padEnd(10) +
          weakMean[i].toFixed(1).padEnd(10) +
          `${diff.toFixed(2)} ${mark}`
      );
    });
  }
  console.log("\nmid 档样本数: " + group.mid.length);

  // ── 3. 客观指标相关性：数据思维分 vs 数字出现次数 ──
  console.log("\n── 测试 3: 客观指标相关性（数据思维分 vs 回答中数字出现次数）──");
  console.log("判定：按数据思维分排序后，数字次数大致跟随 = 分数有依据\n");
  const rows = results.map(({ sample, reports }) => {
    const dataScores = reports.map((r) => {
      const d = r.dimensions.find((x) => x.key === "data");
      return d ? d.score : null;
    }).filter((v) => v !== null);
    return {
      id: sample.id,
      level: sample.level,
      dataScore: dataScores.length ? dataScores.reduce((a, b) => a + b, 0) / dataScores.length : 0,
      digits: countDigits(sample),
      avgLen: avgAnswerLength(sample),
    };
  });
  const byScore = [...rows].sort((a, b) => b.dataScore - a.dataScore);
  console.log("按数据思维分降序:");
  console.log("样本".padEnd(24) + "分数".padEnd(8) + "数字次数".padEnd(10) + "档位");
  for (const r of byScore) {
    console.log(r.id.padEnd(24) + r.dataScore.toFixed(1).padEnd(8) + String(r.digits).padEnd(10) + r.level);
  }
  // 一致性：强档应排在弱档前（简单判定）
  const strongCount = rows.filter((r) => r.level === "strong").length;
  const weakCount = rows.filter((r) => r.level === "weak").length;
  const strongRankSum = byScore.map((r, i) => (r.level === "strong" ? i + 1 : 0)).reduce((a, b) => a + b, 0);
  const weakRankSum = byScore.map((r, i) => (r.level === "weak" ? i + 1 : 0)).reduce((a, b) => a + b, 0);
  const avgStrongRank = strongCount ? strongRankSum / strongCount : 0;
  const avgWeakRank = weakCount ? weakRankSum / weakCount : 0;
  console.log(
    `\n强档平均排名 ${avgStrongRank.toFixed(1)} vs 弱档平均排名 ${avgWeakRank.toFixed(1)}` +
      (avgStrongRank < avgWeakRank ? " ✅ 强档确实排前面" : " ❌ 排名混乱，分数不可靠")
  );

  console.log("\n── 完成。把本输出复制保存到 evaluation/ 下的结果文件留档 ──");
}

main().catch((e) => {
  console.error("诊断失败:", e);
  process.exit(1);
});
