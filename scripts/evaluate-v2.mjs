/**
 * 报告评测 v2 —— 档位命中率 + 稳定性 + 区分度（对照逐维度 golden）
 *
 * 与 evaluate-reports.mjs 的区别：
 *   1. 读 v2 样本集（golden-set-v2.json，50 条，含逐维度 golden 锚点标注）
 *   2. 新增「档位命中率」：模型给的分落在 golden 标注档位（1/3/5）附近即算命中
 *   3. 保留稳定性（同样本 2 次分差）与区分度（强弱档分差）
 *
 * 档位命中判定：
 *   模型分 → 归到最近锚点档（1/3/5），与 golden 的档位一致 = 命中
 *   具体：score∈[1,2)→1档, [2,4)→3档, [4,5]→5档（5 分制）
 *   （评测用 5 分制为主；百分制 ÷20 后同判）
 *
 * 用法：
 *   node scripts/evaluate-v2.mjs [--runs=2] [--limit=50]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? parseInt(runsArg.split("=")[1], 10) : 2;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

const BASE_URL = "http://localhost:3000";
const goldenPath = path.join(__dirname, "..", "evaluation", "golden-set", "golden-set-v2.json");
const resultsRoot = path.join(__dirname, "..", "evaluation", "results");
const { samples } = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

const DIM_KEYS = ["logic", "depth", "data", "agility"];
const DIM_LABELS = { logic: "表达逻辑", depth: "专业深度", data: "数据思维", agility: "应变能力" };

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** 5 分制下，把分数归到最近锚点档 1/3/5 */
function toBucket(score) {
  if (score < 2) return "1";
  if (score < 4) return "3";
  return "5";
}

async function generateReport(sample) {
  const res = await fetch(`${BASE_URL}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: sample.resume,
      messages: sample.messages,
      questionCount: sample.questionCount,
      scale: 5,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`report failed for ${sample.id}: ${res.status} ${text.slice(0, 200)}`);
  }
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

function scoreOf(report, key) {
  const d = (report?.dimensions ?? []).find((x) => x.key === key);
  return d && typeof d.score === "number" ? d.score : null;
}

async function main() {
  const pool = samples.slice(0, LIMIT);
  console.log(`══ 报告评测 v2（档位命中率 + 稳定性 + 区分度）══`);
  console.log(`样本: ${pool.length} 条，每条跑 ${RUNS} 次，5 分制\n`);

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const saveDir = path.join(resultsRoot, `${ts}-v2-scale5`);
  fs.mkdirSync(saveDir, { recursive: true });

  const results = [];
  let failedCount = 0;
  for (const sample of pool) {
    const reports = [];
    let ok = true;
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await generateReport(sample);
        reports.push(r);
        fs.writeFileSync(
          path.join(saveDir, `${sample.id}-run${i + 1}.json`),
          JSON.stringify({ sampleId: sample.id, run: i + 1, scale: 5, report: r }, null, 2)
        );
      } catch (err) {
        ok = false;
        failedCount++;
        console.log(`  [${i + 1}/${RUNS}] ${sample.id} ❌ ${err.message}`);
      }
    }
    if (ok) results.push({ sample, reports });
    else console.log(`  ${sample.id} 有失败轮，跳过统计`);
    if (results.length % 10 === 0) console.log(`  ... 已完成 ${results.length}/${pool.length} 条`);
  }

  // ── 1. 档位命中率 ──
  let hit = 0;
  let total = 0;
  const hitByDim = {};
  DIM_KEYS.forEach((k) => (hitByDim[k] = { hit: 0, total: 0 }));
  const mismatchRows = [];

  for (const { sample, reports } of results) {
    for (const k of DIM_KEYS) {
      const goldenBucket = sample.golden[k].anchor[0]; // "1"/"3"/"5"
      const vals = reports.map((r) => scoreOf(r, k)).filter((v) => v !== null);
      if (!vals.length) continue;
      const avgScore = avg(vals);
      const modelBucket = toBucket(avgScore);
      total++;
      hitByDim[k].total++;
      if (modelBucket === goldenBucket) {
        hit++;
        hitByDim[k].hit++;
      } else {
        mismatchRows.push({
          id: sample.id,
          dim: k,
          golden: goldenBucket,
          model: modelBucket,
          avgScore,
        });
      }
    }
  }

  const accuracy = total ? (hit / total) * 100 : 0;
  console.log(`\n════ 结果 ════`);
  console.log(`\n── 指标 1: 档位命中率（模型档位 vs golden 档位）──`);
  console.log(`总命中率: ${accuracy.toFixed(1)}% (${hit}/${total})`);
  console.log("\n分维度命中率:");
  for (const k of DIM_KEYS) {
    const d = hitByDim[k];
    const pct = d.total ? (d.hit / d.total) * 100 : 0;
    console.log(`  ${DIM_LABELS[k].padEnd(6)} ${pct.toFixed(1)}% (${d.hit}/${d.total})`);
  }

  // ── 2. 稳定性 ──
  const stabDiffs = [];
  for (const { reports } of results) {
    for (const k of DIM_KEYS) {
      const vals = reports.map((r) => scoreOf(r, k)).filter((v) => v !== null);
      if (vals.length >= 2) stabDiffs.push(Math.abs(vals[0] - vals[1]));
    }
  }
  const stability = avg(stabDiffs);
  console.log(`\n── 指标 2: 稳定性（同样本两次分差，越小越稳）──`);
  console.log(`平均分差: ${stability.toFixed(2)} ${stability <= 0.5 ? "✅ 稳" : stability <= 1 ? "⚠️ 一般" : "❌ 不稳"}`);

  // ── 3. 区分度（strong vs weak，逐维）──
  const group = { strong: [], weak: [] };
  for (const { sample, reports } of results) {
    if (sample.level !== "strong" && sample.level !== "weak") continue;
    const perDim = DIM_KEYS.map((k) => {
      const vals = reports.map((r) => scoreOf(r, k)).filter((v) => v !== null);
      return vals.length ? avg(vals) : 0;
    });
    group[sample.level].push(perDim);
  }
  const meanOf = (list) => {
    if (!list.length) return null;
    const sum = new Array(DIM_KEYS.length).fill(0);
    for (const row of list) row.forEach((v, i) => (sum[i] += v));
    return sum.map((v) => v / list.length);
  };
  const strongMean = meanOf(group.strong);
  const weakMean = meanOf(group.weak);
  console.log(`\n── 指标 3: 区分度（strong 均分 - weak 均分）──`);
  if (strongMean && weakMean) {
    DIM_KEYS.forEach((k, i) => {
      const diff = strongMean[i] - weakMean[i];
      const mark = diff >= 1 ? "✅" : diff >= 0.5 ? "⚠️" : "❌";
      console.log(
        `  ${DIM_LABELS[k].padEnd(6)} 强档 ${strongMean[i].toFixed(1)} 弱档 ${weakMean[i].toFixed(1)} 分差 ${diff.toFixed(2)} ${mark}`
      );
    });
  } else {
    console.log("  样本缺 strong/weak 档，跳过");
  }

  // ── 4. 未命中明细（供定位锚点问题）──
  console.log(`\n── 未命中明细（共 ${mismatchRows.length} 处）──`);
  const byDimMismatch = {};
  for (const r of mismatchRows) {
    byDimMismatch[r.dim] = (byDimMismatch[r.dim] ?? 0) + 1;
    console.log(`  ${r.id} ${DIM_LABELS[r.dim]} golden=${r.golden}档 模型=${r.model}档(均分${r.avgScore.toFixed(1)})`);
  }

  console.log(`\n── 完成。存档: ${path.basename(saveDir)} ──`);
  console.log(`失败轮次: ${failedCount}`);
}

main().catch((e) => {
  console.error("评测失败:", e.message ?? e);
  process.exit(1);
});
