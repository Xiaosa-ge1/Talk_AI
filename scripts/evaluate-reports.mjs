/**
 * 评测准确性诊断工具（跑分脚本）
 *
 * 用途：对 golden set 每条样本调用 /api/report，输出三个测试的结果：
 *   1. 稳定性：同一样本生成 N 次，维度分差多大（越小越稳）
 *   2. 区分度：强档 vs 弱档每维均分差（越大越能分开好坏）
 *   3. 客观指标相关性：样本里"出现数字的次数"与"数据思维分"排序是否一致
 *
 * 分制对比实验（--scale）：
 *   百分制分数域是 5 分制的 20 倍，分差绝对值天然更大 —— 直接拿
 *   "5 分制平均分差 0.47" 和 "百分制平均分差 8.5" 比较是无效的。
 *   因此所有判定统一归一化到 5 分制（百分制 ÷20）后再比较，
 *   输出同时给出原始值与归一化值，结论只看归一化值。
 *
 * 依赖：在线跑分需要本地 dev server 运行中（http://localhost:3000）
 * 用法：
 *   node scripts/evaluate-reports.mjs [--runs=2] [--scale=5|100]   在线跑分（烧 token）
 *   node scripts/evaluate-reports.mjs --from=<dir>                 离线复算（不烧 token）
 *   node scripts/evaluate-reports.mjs --compare=<dirA>,<dirB>      两种分制离线对比
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 参数 ──
const runsArg = process.argv.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? parseInt(runsArg.split("=")[1], 10) : 2;
const scaleArg = process.argv.find((a) => a.startsWith("--scale="));
const SCALE = scaleArg && scaleArg.split("=")[1] === "100" ? 100 : 5;
const fromArg = process.argv.find((a) => a.startsWith("--from="));
const compareArg = process.argv.find((a) => a.startsWith("--compare="));

const BASE_URL = "http://localhost:3000";
const goldenPath = path.join(__dirname, "..", "evaluation", "golden-set", "golden-set.json");
const resultsRoot = path.join(__dirname, "..", "evaluation", "results");
const { samples } = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

// ── 常量：判定阈值统一在「归一化到 5 分制」的域里，两种分制才可比 ──
const DIM_KEYS = ["logic", "depth", "data", "agility"];
const DIM_LABELS = { logic: "表达逻辑", depth: "专业深度", data: "数据思维", agility: "应变能力" };
const STABILITY_OK = 0.5; // 归一化分差 ≤0.5 判稳
const STABILITY_WARN = 1; // ≤1 一般，>1 不稳
const DISCRIMINATION_OK = 1; // 归一化强-弱分差 ≥1 判能分开
const PERCENT_DIVISOR = 20; // 百分制 ÷20 归一到 5 分制

const toNorm = (v, scale) => (scale === 100 ? v / PERCENT_DIVISOR : v);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

async function generateReport(sample, scale) {
  const res = await fetch(`${BASE_URL}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resume: sample.resume,
      messages: sample.messages,
      questionCount: sample.questionCount,
      scale,
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

/** 取某报告某维度的分数（缺失返回 null，不参与统计） */
function scoreOf(report, key) {
  const d = (report?.dimensions ?? []).find((x) => x.key === key);
  return d && typeof d.score === "number" ? d.score : null;
}

/** 读取某次落盘目录，还原成 results（样本 → 报告列表），并推断该批的分制 */
function loadFromDir(dirInput) {
  const dir = path.isAbsolute(dirInput) ? dirInput : path.join(resultsRoot, dirInput);
  if (!fs.existsSync(dir)) {
    throw new Error(`结果目录不存在: ${dir}`);
  }
  const byId = {};
  let scale = 5; // 老存档无 scale 字段，按 5 分制处理
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (j.scale === 100) scale = 100;
    if (!byId[j.sampleId]) {
      const golden = samples.find((s) => s.id === j.sampleId);
      byId[j.sampleId] = {
        sample: golden ?? { id: j.sampleId, level: j.level },
        reports: [],
      };
    }
    byId[j.sampleId].reports.push(j.report);
  }
  return { dir, results: Object.values(byId), scale };
}

/**
 * 三测试统计（纯计算，在线跑分 / 离线复算 / 分制对比共用）
 * @returns 结构化指标；所有判定相关的值都用归一化到 5 分制的 norm 字段
 */
function computeTests(results, scale) {
  // ── 1. 稳定性：同一样本各维度两次分差 ──
  const stabilityRows = results.map(({ sample, reports }) => {
    const diffs = DIM_KEYS.map((k) => {
      const vals = reports.map((r) => scoreOf(r, k)).filter((v) => v !== null);
      if (vals.length < 2) return 0;
      return Math.abs(vals[0] - vals[1]);
    });
    const rawAvg = avg(diffs);
    return { id: sample.id, diffs, rawAvg, normAvg: toNorm(rawAvg, scale) };
  });
  const stability = {
    rows: stabilityRows,
    rawAvg: avg(stabilityRows.map((r) => r.rawAvg)),
    normAvg: avg(stabilityRows.map((r) => r.normAvg)),
  };

  // ── 2. 区分度：强档 vs 弱档每维均分差 ──
  const group = { strong: [], mid: [], weak: [] };
  for (const { sample, reports } of results) {
    const perDim = DIM_KEYS.map((k) => {
      const vals = reports.map((r) => scoreOf(r, k)).filter((v) => v !== null);
      return vals.length ? avg(vals) : 0;
    });
    if (group[sample.level]) group[sample.level].push(perDim);
  }
  // 注意：不可把 arr[0] 当 reduce 初始值，否则首元素被算两次（曾导致假数据）
  const meanOf = (list) => {
    if (!list.length) return null;
    const sum = new Array(DIM_KEYS.length).fill(0);
    for (const row of list) row.forEach((v, i) => (sum[i] += v));
    return sum.map((v) => v / list.length);
  };
  const strongMean = meanOf(group.strong);
  const weakMean = meanOf(group.weak);
  const discRows =
    strongMean && weakMean
      ? DIM_KEYS.map((k, i) => {
          const rawDiff = strongMean[i] - weakMean[i];
          return {
            key: k,
            label: DIM_LABELS[k],
            strong: strongMean[i],
            weak: weakMean[i],
            rawDiff,
            normDiff: toNorm(rawDiff, scale),
          };
        })
      : [];
  const discrimination = {
    rows: discRows,
    rawAvg: avg(discRows.map((r) => r.rawDiff)),
    normAvg: avg(discRows.map((r) => r.normDiff)),
    midCount: group.mid.length,
  };

  // ── 3. 客观指标相关性：数据思维分 vs 数字出现次数 ──
  const corrRows = results.map(({ sample, reports }) => {
    const vals = reports.map((r) => scoreOf(r, "data")).filter((v) => v !== null);
    return {
      id: sample.id,
      level: sample.level,
      dataScore: vals.length ? avg(vals) : 0,
      digits: countDigits(sample),
      avgLen: avgAnswerLength(sample),
    };
  });
  const byScore = [...corrRows].sort((a, b) => b.dataScore - a.dataScore);
  const strongRanks = byScore.map((r, i) => (r.level === "strong" ? i + 1 : 0)).filter((v) => v > 0);
  const weakRanks = byScore.map((r, i) => (r.level === "weak" ? i + 1 : 0)).filter((v) => v > 0);
  const correlation = {
    rows: byScore,
    avgStrongRank: avg(strongRanks),
    avgWeakRank: avg(weakRanks),
  };

  return { scale, stability, discrimination, correlation };
}

/** 打印三测试明细（在线跑分与离线复算共用） */
function printTests(tests, runs, title) {
  console.log(`\n════ ${title} ════`);
  console.log(
    `分制: ${tests.scale} 分制` +
      (tests.scale === 100 ? "（判定值已归一化到 5 分制，即原始值 ÷20）" : "")
  );

  // 测试 1 稳定性
  console.log(
    `\n── 测试 1: 稳定性（同样本 ${runs} 次生成，每维分差；越小越稳）──`
  );
  console.log("判定：归一化平均分差 ≤0.5 稳，≤1 一般，>1 不稳\n");
  console.log("样本".padEnd(24) + DIM_KEYS.map((k) => DIM_LABELS[k]).join("  "));
  for (const r of tests.stability.rows) {
    console.log(r.id.padEnd(24) + r.diffs.map((d) => d.toFixed(1)).join("  "));
  }
  const s = tests.stability;
  const stableMark =
    s.normAvg <= STABILITY_OK ? "✅ 稳" : s.normAvg <= STABILITY_WARN ? "⚠️ 一般" : "❌ 不稳";
  const rawNote = tests.scale === 100 ? `原始 ${s.rawAvg.toFixed(2)} → 归一化 ` : "";
  console.log(`\n平均分差: ${rawNote}${s.normAvg.toFixed(2)} ${stableMark}\n`);

  // 测试 2 区分度
  console.log("── 测试 2: 区分度（strong 均分 - weak 均分，每维）──");
  console.log("判定：归一化分差 ≥1 算能分开好坏\n");
  console.log("维度".padEnd(10) + "强档均分".padEnd(10) + "弱档均分".padEnd(10) + "分差(归一化)");
  for (const r of tests.discrimination.rows) {
    const mark = r.normDiff >= DISCRIMINATION_OK ? "✅" : r.normDiff >= 0.5 ? "⚠️" : "❌";
    console.log(
      r.label.padEnd(10) +
        r.strong.toFixed(1).padEnd(10) +
        r.weak.toFixed(1).padEnd(10) +
        `${r.normDiff.toFixed(2)} ${mark}`
    );
  }
  console.log(
    `归一化均分差: ${tests.discrimination.normAvg.toFixed(2)}` +
      `（原始 ${tests.discrimination.rawAvg.toFixed(2)}）  mid 档样本数: ${tests.discrimination.midCount}`
  );

  // 测试 3 相关性
  console.log("\n── 测试 3: 客观指标相关性（数据思维分 vs 回答中数字出现次数）──");
  console.log("判定：按数据思维分排序后，强档应整体排在弱档前\n");
  console.log("按数据思维分降序:");
  console.log("样本".padEnd(24) + "分数".padEnd(8) + "数字次数".padEnd(10) + "档位");
  for (const r of tests.correlation.rows) {
    console.log(
      r.id.padEnd(24) + r.dataScore.toFixed(1).padEnd(8) + String(r.digits).padEnd(10) + r.level
    );
  }
  const c = tests.correlation;
  console.log(
    `\n强档平均排名 ${c.avgStrongRank.toFixed(1)} vs 弱档平均排名 ${c.avgWeakRank.toFixed(1)}` +
      (c.avgStrongRank < c.avgWeakRank ? " ✅ 强档确实排前面" : " ❌ 排名混乱，分数不可靠")
  );
}

/** 分制对比：两个存档目录离线对比，结论只看归一化值 */
function printCompare(a, b) {
  console.log(`\n════ 分制对比实验 ════`);
  console.log(`A: ${path.basename(a.dir)}（${a.scale} 分制, ${a.results.length} 条样本）`);
  console.log(`B: ${path.basename(b.dir)}（${b.scale} 分制, ${b.results.length} 条样本）`);
  if (a.scale === b.scale) {
    console.log("\n⚠️ 两批数据分制相同，无法构成分制对比");
  }

  const ta = computeTests(a.results, a.scale);
  const tb = computeTests(b.results, b.scale);
  console.log("\n── 对比（判定值均为归一化到 5 分制，可直接比较）──\n");
  console.log("指标".padEnd(22) + String(a.scale + " 分制").padEnd(12) + String(b.scale + " 分制").padEnd(12) + "差异");

  const row = (name, va, vb, lowerBetter) => {
    const diff = vb - va;
    const better = lowerBetter ? diff < 0 : diff > 0;
    const verdict =
      Math.abs(diff) < 0.05 ? "基本持平" : better ? `${b.scale} 分制更好 ✅` : `${a.scale} 分制更好 ✅`;
    console.log(
      name.padEnd(22) + va.toFixed(2).padEnd(12) + vb.toFixed(2).padEnd(12) + `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}  ${verdict}`
    );
  };

  row("稳定性(平均分差, 小好)", ta.stability.normAvg, tb.stability.normAvg, true);
  row("区分度(强-弱分差, 大好)", ta.discrimination.normAvg, tb.discrimination.normAvg, false);
  console.log(
    "强档平均排名(小好)".padEnd(22) +
      ta.correlation.avgStrongRank.toFixed(1).padEnd(12) +
      tb.correlation.avgStrongRank.toFixed(1).padEnd(12) +
      (tb.correlation.avgStrongRank < ta.correlation.avgStrongRank
        ? `${b.scale} 分制更好 ✅`
        : tb.correlation.avgStrongRank > ta.correlation.avgStrongRank
          ? `${a.scale} 分制更好 ✅`
          : "持平")
  );

  console.log("\n── 结论建议 ──");
  const stabBetter = tb.stability.normAvg < ta.stability.normAvg - 0.05;
  const discBetter = tb.discrimination.normAvg > ta.discrimination.normAvg + 0.05;
  if (stabBetter && discBetter) {
    console.log(`${b.scale} 分制在稳定性与区分度上均更优，建议采用 ${b.scale} 分制。`);
  } else if (!stabBetter && !discBetter) {
    console.log(`${a.scale} 分制在稳定性与区分度上均不差，建议沿用 ${a.scale} 分制（改动成本更低）。`);
  } else {
    console.log(
      `两种分制各有优劣：稳定性 ${stabBetter ? b.scale : a.scale} 分制更好，` +
        `区分度 ${discBetter ? b.scale : a.scale} 分制更好。需按产品诉求取舍（报告页要稳还是要分辨力）。`
    );
  }
}

async function main() {
  // 模式一：分制对比（离线）
  if (compareArg) {
    const parts = compareArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 2) {
      throw new Error("--compare 需要两个目录，如 --compare=<dirA>,<dirB>");
    }
    printCompare(loadFromDir(parts[0]), loadFromDir(parts[1]));
    console.log("\n── 完成（离线对比，未消耗 token）──");
    return;
  }

  // 模式二：离线复算
  if (fromArg) {
    const loaded = loadFromDir(fromArg.split("=")[1]);
    printTests(computeTests(loaded.results, loaded.scale), loaded.results[0]?.reports.length ?? "?", `离线复算 · ${path.basename(loaded.dir)}`);
    console.log("\n── 完成（离线复算，未消耗 token）──");
    return;
  }

  // 模式三：在线跑分（烧 token）
  console.log(`══ 评测准确性诊断（golden set: ${samples.length} 条, 每条跑 ${RUNS} 次, ${SCALE} 分制）══\n`);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const saveDir = path.join(resultsRoot, `${ts}-scale${SCALE}`);
  fs.mkdirSync(saveDir, { recursive: true });
  console.log(`报告存档: ${saveDir}\n`);

  const results = [];
  const failed = [];
  for (const sample of samples) {
    const reports = [];
    let ok = true;
    for (let i = 0; i < RUNS; i++) {
      try {
        const r = await generateReport(sample, SCALE);
        reports.push(r);
        fs.writeFileSync(
          path.join(saveDir, `${sample.id}-run${i + 1}.json`),
          JSON.stringify(
            { sampleId: sample.id, level: sample.level, run: i + 1, scale: SCALE, report: r },
            null,
            2
          )
        );
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

  printTests(computeTests(results, SCALE), RUNS, `在线跑分 · ${SCALE} 分制`);
  console.log(
    `\n── 完成。存档: ${path.basename(saveDir)} ──\n` +
      `对比命令: node scripts/evaluate-reports.mjs --compare=<5分制目录>,${path.basename(saveDir)}`
  );
}

main().catch((e) => {
  console.error("诊断失败:", e.message ?? e);
  process.exit(1);
});
