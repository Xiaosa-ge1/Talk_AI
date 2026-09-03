# 评测准确性提升 · 工作交接文档（HANDOFF）

> 写于 2026-09-03。**任何人（包括新的 AI 会话）接手本工作时，先读本文档**，
> 再按「下一步」清单继续。所有代码改动已在工作区，未提交 git（如需提交见文末）。

---

## 一、这个工作要解决什么（背景）

用户是产品思维训练者，做一个 AI 面试陪练产品（纯文字，Next.js + DeepSeek + IndexedDB，位于 E:\Talk AI\interview-coach）。迭代需求：**提升面试报告评测的准确性**。

现状问题（已被证实）：
- 报告评分是 LLM 读完对话后一次性输出的"感觉分"，无评分标准、无证据引用、温度 0.8
- 用 golden set 实测：**改造前 18 次生成中 9 次解析失败（失败率 50%）**——评测不可用的最硬证据

用户确定的测试方向（不采用人评一致性，个人开发者太重）：
**稳定性 + 区分度 + 客观指标相关性** 三个指标，外加 **5 分制 vs 百分制对比实验**。

## 二、已完成的工作（按顺序）

### 1. 金标准样本集（golden set）✅
- 生成脚本：`scripts/gen-golden-set.mjs`（一次性脚本，产物已入库）
- 产物：`evaluation/golden-set/golden-set.json` —— **9 条完整面试样本**
- 设计：3 个场景（recommend 电商推荐 / zerotoone 从0到1产品 / growth 用户增长）× 3 档回答（strong 强 / mid 中 / weak 弱）
- 关键：同一场景内**面试官提问序列完全一致**，只替换候选人回答质量 → 区分度测试公平
- 每条样本结构：`{id, scene, level, levelNote, resume, questionCount, messages[]}`
- **注意**：level 是"预期档位"，测试前应人工抽审确认（用户抽审 1/3）

### 2. 跑分诊断脚本 ✅
- 位置：`scripts/evaluate-reports.mjs`
- 用法：`node scripts/evaluate-reports.mjs [--runs=2]`（需本地 dev server 在 http://localhost:3000 运行）
- 功能：对每条样本调 /api/report，输出三个测试结果：
  1. **稳定性**：同样本多次生成，每维分差（判定 ≤0.5 稳）
  2. **区分度**：strong 均分 - weak 均分每维对比（判定 ≥1 分）
  3. **客观指标相关性**：数据思维分 vs 回答中数字出现次数（判定强档排前面）
- 单条失败会跳过不中断（失败本身也是评测不稳定的证据）
- 会真实消耗 LLM token（9 条 × runs 次报告生成）

### 3. 评测改造（代码已改，未验证）✅ 代码完成
- **温度**：`src/lib/deepseek.ts` — `DeepSeekClient` 构造与 `streamChat` 参数支持 `temperature`；report route 传 0.2，chat 默认 0.8
- **评分标准模块**：新增 `src/lib/rubric.ts`（+ `rubric.test.ts` 4 测试）
  - `DIMENSION_LABELS`（4 维中文名）移到这里
  - 每维有 1/3/5 分**行为锚点**描述（如数据思维 1 分=全程无数字，5 分=口径清晰能拆指标有 AB 验证）
  - `buildRubricPromptText()` 生成评分标准文本
- **report.ts 接入 rubric**：`buildReportSystemPrompt` 现在包含评分标准 + 明确"必须给 evidence（引用对话原句）"
- **types.ts**：`DimensionScore` 增加 `evidence?: string` 字段
- **report.ts sanitize**：保留 evidence（截断 200 字）

### 4. 关键 bug 发现并修复 ✅（这是改造后重跑仍失败才查出来的）
- **现象**：温度降到 0.2 + 加 rubric 后，诊断仍大量失败（~70%）
- **根因**：LLM 输出 JSON 结构不稳定——有时平铺 `{summary, dimensions...}`，有时包一层 `{"report": {...}}`；`sanitizeReport` 只认平铺，遇到包裹结构 `obj.summary` 为 undefined → 判解析失败
- **修复**：`src/lib/report.ts` 的 `parseReport` — 解析后若顶层无 summary 但含 `report` 键则解包再校验（已加测试，15 个 report 测试全过）

## 三、当前状态

- 代码改动：`deepseek.ts` / `report.ts` / `rubric.ts`(+test) / `types.ts` / `report.test.ts` / `eslint.config.mjs`（scripts/、evaluation/ 加入 eslint 忽略）
- 测试：report/rubric 相关单测通过（typecheck ✅）
- **dev server 需要重启**才能加载新代码（当前运行的是旧代码）
- 尚未：重跑诊断对比基线、分制实验、报告页证据展示

## 四、下一步（按顺序执行）

1. **重启 dev server** 加载新代码：
   - 找到 3000 端口进程并停止（Git Bash 下 `taskkill //PID <pid> //F` 或 PowerShell `Stop-Process`）
   - `cd E:\Talk AI\interview-coach && npm run dev`（后台）
2. **重跑诊断**：`node scripts/evaluate-reports.mjs --runs=2`
   - 预期：解析失败率大幅下降（parseReport 解包修复），稳定性/区分度/相关性才有数据
3. **对比基线**：改造前基线 = 50% 失败率（当时几乎无有效数据）。改造后若三测试能跑出数字即进步；记录结果
4. **分制对比实验**：5 分制 vs 百分制各跑同一批样本，比较稳定性与区分度，定结论（用户想验证百分制是否更稳）
5. **报告页加"评分依据"**：ReportView 展示每条维度的 evidence（评分可人工核验）
6. **收尾**：quality 全绿 + 浏览器回归 + evaluation 结果留档入库

## 五、需要用户参与的事

- **人工审定 golden set**：用户通读 9 条样本，抽审 1/3 确认 level（强/中/弱）标注合理
- 分制实验结论需要用户拍板采纳哪种
- git 提交时机由用户决定

## 六、相关命令速查

```bash
cd E:\Talk AI\interview-coach
npm run quality          # lint+format+typecheck+test 全绿
node scripts/gen-golden-set.mjs   # 重新生成样本（一般不需要）
node scripts/evaluate-reports.mjs --runs=2   # 跑评测诊断（烧 token）
```

## 七、关键文件清单

| 文件 | 作用 |
| --- | --- |
| `evaluation/golden-set/golden-set.json` | 9 条固定测试样本 |
| `scripts/evaluate-reports.mjs` | 跑分诊断工具 |
| `scripts/gen-golden-set.mjs` | 样本生成器（一次性） |
| `src/lib/rubric.ts` | 评分标准（维度锚点） |
| `src/lib/report.ts` | 报告 prompt 组装 + 解析容错 |
| `src/lib/deepseek.ts` | LLM 客户端（temperature 支持） |
| `src/lib/types.ts` | DimensionScore.evidence |
| `RETRO.md` | 项目复盘（含评测相关教训：温度 0.8 失误已记录） |
