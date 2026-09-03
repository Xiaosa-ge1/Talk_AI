# 评测诊断结果 · 5 分制 · 解析改造后（runs=2）

> 日期：2026-09-03
> 配置：temperature 0.2 + rubric 评分标准 + prompt 显式 JSON schema 示例 + 宽容解析（alias/对象形态）
> 原始报告存档：`evaluation/results/2026-09-03T00-48-42/`（18 份 JSON）

## 关键结论

| 指标 | 改造前基线 | 本结果 |
| --- | --- | --- |
| 解析失败率 | 9/18（50%） | **0/18（0%）** |
| 稳定性（平均分差） | 无有效数据 | 0.47 ✅（≤0.5 稳） |
| 区分度（强-弱分差） | 无有效数据 | 2.33~3.33 全 ✅（≥1） |
| 客观相关性 | 无有效数据 | 强档排名 2.0 vs 弱档 8.0 ✅ |

## 三测试明细

### 测试 1：稳定性（同样本 2 次生成，每维分差，≤0.5 稳）
```
样本                      表达逻辑  专业深度  数据思维  应变能力
growth-mid              1.0  0.0  0.0  0.0
growth-strong           0.0  1.0  0.0  2.0
growth-weak             0.0  0.0  0.0  0.0
recommend-mid           1.0  0.0  0.0  0.0
recommend-strong        1.0  1.0  0.0  0.0
recommend-weak          1.0  1.0  1.0  1.0
zerotoone-mid           1.0  1.0  1.0  1.0
zerotoone-strong        0.0  0.0  1.0  0.0
zerotoone-weak          0.0  1.0  0.0  0.0
平均分差: 0.47 ✅ 稳
```
注意：growth-strong 应变能力分差 2.0（两轮差 2 分）是唯一明显抖动点。

### 测试 2：区分度（strong 均分 - weak 均分，≥1 算能分开）
```
维度        强档均分      弱档均分      分差
表达逻辑      4.2       1.8       2.33 ✅
专业深度      3.7       1.3       2.33 ✅
数据思维      4.5       1.2       3.33 ✅
应变能力      3.7       1.2       2.50 ✅
mid 档样本数: 3
```

### 测试 3：客观指标相关性（数据思维分 vs 回答中数字出现次数）
```
按数据思维分降序:
样本                      分数      数字次数      档位
recommend-strong        5.0     12        strong
zerotoone-strong        4.5     17        strong
growth-strong           4.0     24        strong
zerotoone-mid           3.5     6         mid
growth-mid              3.0     5         mid
recommend-mid           2.0     1         mid
recommend-weak          1.5     1         weak
growth-weak             1.0     0         weak
zerotoone-weak          1.0     2         weak
强档平均排名 2.0 vs 弱档平均排名 8.0 ✅ 强档确实排前面
```
强/中/弱三档排序完全无串档，分数与回答中数字密度强相关。

## 本次新发现并修复的问题（重要）

1. **LLM schema 漂移导致高解析失败率**（首轮重跑仍 7/18 失败）：
   实测 LLM 输出字段名/结构不稳定——`summary` 写成 `overall`、`dimensions` 写成按维度名 key 的对象、`highlight` 写成复数数组甚至纯字符串、`highlight.reason` 代替 `praise`。
   - 修复 1：prompt 加入显式 JSON schema 示例 + 「字段名一个都不能改」
   - 修复 2：解析器宽容处理（别名、dimensions 数组/对象两形态、highlight 归一）——`src/lib/report.ts`
   - 效果：失败率 7/18 → 0/18；且此前「dimensions 对象形态被当空 → 全部默认 3 分」的**假成功**（污染稳定性/区分度统计）被根除
2. **诊断脚本统计 bug**：`mean()` 用 `reduce(cb, arr[0])`，首元素被算两次 → 强档均分出现 >5 的假数据（7.3/6.2 等）。已修复并支持 `--from=<dir>` 离线复算。
3. 补 6 个回归单测（用真实漂移输出），report/rubric 共 25 个测试全过。

## 复算命令

```bash
node scripts/evaluate-reports.mjs --from=2026-09-03T00-48-42   # 不烧 token 重算统计
```
