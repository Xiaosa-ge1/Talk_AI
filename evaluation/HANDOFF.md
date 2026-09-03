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

### 5. 报告页「评分依据」展示 ✅
- `src/components/ReportView.tsx`：维度条下方渲染 `evidence`（LLM 引用的对话原句），让分数可人工核验；无 evidence 时不渲染该行
- 测试：ReportView 新增 2 个（有 evidence 展示 / 无 evidence 不显示）

### 6. 分制支持（5 分制 vs 百分制对比实验的基础）✅ 代码完成
- `src/lib/types.ts`：新增 `ScoreScale = 5 | 100`；`ReportRequestBody.scale?`（缺省 5 分制，仅评测脚本使用）
- `src/lib/rubric.ts`：新增 `anchorScores(scale)`（5 分制锚点 1/3/5、百分制 20/60/100）、`scoreFloor`、`defaultScoreOf`、`normalizeScale`；`buildRubricPromptText(scale)` 的行为描述与分制无关，只换算锚点分值
- `src/lib/report.ts`：prompt 的 JSON 示例与规则随分制变化；`toScore / normalizeDimensions / sanitizeReport / parseReport / defaultDimensions` 全部接受 scale，百分制收敛到 0-100
- `src/app/api/report/route.ts`：透传 `scale`（经 `normalizeScale` 归一化，非法值回落 5 分制）。**产品前端不传该字段，分数语义与收敛区间不变（缺省 5 分制）；但 5 分制 prompt 文本本身较旧版有变化（新增 JSON 输出示例块与分制说明行），属解析稳定性改进，非行为变更**
- `scripts/evaluate-reports.mjs`：支持 `--scale=5|100`；新增 `--compare=<dirA>,<dirB>` 离线对比模式
- ⚠️ **归一化是对比实验的关键**：百分制分数域是 5 分制的 20 倍，分差绝对值天然更大，直接比较「0.47 vs 8.5」是无效的。脚本所有判定统一归一化到 5 分制（百分制 ÷20）后再比较，输出同时给出原始值与归一化值
- 已用离线方式验证归一化正确：把 5 分制存档 ×20 伪造为百分制后，归一化对比结果为**差异 +0.00 持平**（若未归一化会显示 9.4 的假差异）
- 测试：rubric 新增 5 个、report 新增 5 个

## 三、当前状态

- 代码改动：`deepseek.ts` / `report.ts` / `rubric.ts`(+test) / `types.ts` / `report.test.ts` / `ReportView.tsx`(+test) / `api/report/route.ts` / `scripts/evaluate-reports.mjs` / `eslint.config.mjs` + `.prettierignore`（scripts/、evaluation/ 加入忽略）
- **质量门禁全绿**：`npm run quality` 通过，**124 个测试**（lint + format:check + typecheck + vitest）
- 三测试已跑通且有结论（见 `evaluation/results/2026-09-03-5point-after-parser-fix.md`）：稳定性 0.47 ✅ / 区分度 2.33~3.33 ✅ / 相关性 强档排名 2.0 vs 弱档 8.0 ✅；解析失败率 50% → 0%
- 报告页 evidence 展示已上线；分制支持已就绪（产品默认 5 分制，行为无变化）
- **尚未**：真实跑一遍百分制实验并出对比结论（需启动 dev server + 消耗 token）

## 四、下一步（按顺序执行）

> 进度更新（2026-09-03）：1–3、5 已完成，见第二、三节。**只剩第 4 项与收尾。**

1. ~~重启 dev server 加载新代码~~ ✅
2. ~~重跑诊断~~ ✅
3. ~~对比基线~~ ✅（失败率 50% → 0%，三测试全部达标，结果已留档）
4. **分制对比实验**（唯一剩余项，会消耗 token）：
   ```bash
   npm run dev                                            # 启动 dev server
   node scripts/evaluate-reports.mjs --runs=2 --scale=100  # 生成 <ts>-scale100/
   node scripts/evaluate-reports.mjs --compare=2026-09-03T00-48-42,<ts>-scale100
   ```
   - 对比命令是离线的、不烧 token，可反复对不同存档跑
   - **结论只看归一化值**：稳定性取更小者，区分度取更大者；两种分制各有优劣时按产品诉求取舍（要稳还是要分辨力）
5. ~~报告页加"评分依据"~~ ✅
6. **收尾**：
   - 实验结论写入 `evaluation/results/` 留档；**采纳哪种分制需用户拍板**
   - 浏览器人工回归报告页（确认 evidence 展示正常、5 分制显示未受影响）
   - git 提交（时机由用户决定）

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
| `src/lib/rubric.ts` | 评分标准（维度锚点 + 分制换算 anchorScores/normalizeScale） |
| `src/lib/report.ts` | 报告 prompt 组装 + 解析容错（均支持 scale） |
| `src/components/ReportView.tsx` | 报告展示（含 evidence 评分依据） |
| `src/lib/deepseek.ts` | LLM 客户端（temperature 支持） |
| `src/lib/types.ts` | DimensionScore.evidence、ScoreScale、ReportRequestBody.scale |
| `RETRO.md` | 项目复盘（含评测相关教训：温度 0.8 失误已记录） |
