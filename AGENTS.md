<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI 面试陪练（Interview Coach）· AI Agent 约束文件

> 这是本项目对任何 AI 编程 agent 的**硬性约束**。开工前必读；违反以下红线视为交付不合格。

## 1. 产品是什么

上传真实简历（PDF/Word）→ AI 扮演产品经理岗面试官进行多轮追问 → 结束后生成面试报告（总评 + 维度评估 + 重点改进 3 处 + 重答这题）。文字为主，支持**语音作答**（录音 → 讯飞识别 → 填入输入框可改后发送）与 **AI 提问朗读**（浏览器 SpeechSynthesis，优先中文神经音色）。MVP 面向单人本地使用（Windows/Edge 效果最佳）。

## 2. 质量门禁（最重要——任何阶段交付前必须全绿）

**运行 `npm run quality`，四项全过才算完成，否则不算完成：**

```bash
npm run quality   # = lint + format:check + typecheck + vitest run
```

- `lint`：ESLint（禁 `any`、禁遗留 `console.log`，允许 `warn/error`）
- `format:check`：Prettier 统一格式
- `typecheck`：`tsc --noEmit`，TS strict
- `test`：Vitest。**LLM 相关测试必须 mock，不得在测试中发起真实网络请求**
- 覆盖率门槛：`src/lib/**` 核心逻辑行/语句/函数 ≥ 80%（见 vitest.config.ts；组件要求关键交互有测试）
- 测试哲学（tdd）：测试验证**公开接口行为**、写在**预先约定的 seam**，不测实现细节；禁止为凑覆盖率写水平切片测试或同义反复断言
- 修复格式用 `npm run format`（写文件），不要手动改格式

### 省 token 测试原则（评测/真机验证时遵守）

> 目标：任何需要真实调用 LLM 的评测/验证，都用最小 token 拿到所要结论。

1. **测什么，就只让模型输出什么**：测四维分数只输出分数（`/api/score`），测追问质量只输出下一个问题，测同质化只输出问题本身——禁止为了测一个小功能而生成整篇报告。
2. **能用结构化短格式就不用长文本**：要求模型输出 JSON / 短句，而非带解释的自然长文。
3. **能本地算的指标绝不让模型多吐一个字**：多样性（相似度/去重率）、简历关键词命中、字错率（WER/CER）等，一律本地计算，0 token。
4. **控制输入长度**：只喂被测功能真正依赖的上下文（简历截断、只给最近一轮问答），不塞无关历史。
5. **先小样本冒烟，再全量**：先用 `--limit` 跑几条验证流程/格式，确认无误再放大。
6. **⚠️ 每次省 token 方案先经用户确认**：任何"为省 token 而裁剪输出/输入/轮次"的具体做法，动手前必须先向用户说明省了什么、会损失什么信息，经用户同意后才执行——不得擅自决定省 token 而牺牲评测可信度。

## 3. 模块 / 依赖 / 生命周期约束（交付前逐条自查，不满足不算完成）

### 模块与依赖

1. 目录即边界：`app/`（API route）只做请求编排，不写业务逻辑；`components/` 只做 UI；业务/数据逻辑一律在 `lib/`
2. 依赖单向：`components/ → lib/ → (types / 外部包)`。`lib/` 内禁止 import 任何 `app/` 或 `components/` 的代码（出现即循环依赖）
3. `types.ts` 是共享类型的唯一来源；禁止在组件内联重复类型
4. 外部服务（LLM/文件解析）必须经 `lib/` 的可注入接口调用；组件只允许 `fetch("/api/*")`，禁止直连第三方

### 函数与类

5. 纯逻辑与副作用分离：fetch / IndexedDB / 浏览器 API 只在边界函数；算法/组装逻辑保持纯函数（可单测）
6. 函数单一职责；命名说明"做什么"，不写"怎么做"
7. 优先函数 + 类型，少用类；若用类，构造函数只接收依赖（可注入）

### 生命周期约束（防资源浪费）

8. 新写的"优化/工具函数"必须当步被调用——验收"生效"而非"存在"（反例：`summarizeResumeForPrompt` 写了未接线）
9. 替换旧实现时，同一 commit 内删除旧代码及其测试，不留死代码
10. 组件超过约 200 行时拆出逻辑层（hook / 纯函数模块）
11. 防重复执行的 ref 记录"处理过的 id"（如 sessionId），禁止用 boolean

## 4. 架构与密钥红线（不可违反）

- **API 密钥只在服务端**：`DEEPSEEK_API_KEY`、`XFYUN_APP_ID` / `XFYUN_API_KEY` / `XFYUN_API_SECRET`（讯飞语音听写，控制台应用添加「语音听写（流式版）」服务后查看，APISecret 取控制台显示原值）都放在 `.env.local`（已被 .gitignore 忽略），只由 API route（服务端）读取。**任何情况下不得把 key 传给前端组件/浏览器，不得用 `NEXT_PUBLIC_*` 前缀暴露**
- 前端只通过 `fetch("/api/*")` 调用后端；外部服务调用（DeepSeek 走 `src/lib/deepseek.ts`，讯飞语音听写走 `src/lib/asr-client.ts` 的 iat v2 WebSocket 客户端）都必须经由可注入接口（便于测试 mock）
- 无数据库、无账号：用户数据（面试会话、报告）只存浏览器 IndexedDB（`src/lib/store.ts`）
- 报告保留最近 50 条自动清理（store 内实现）

## 5. 对话状态机（对话页核心，防并发错乱）

实际实现为三相（见 `src/hooks/useInterviewChat.ts` 的 `InterviewPhase`）：

```
loading（加载会话/建临时会话）→ ready（等用户作答，AI 生成中不可提交）
     → thinking（AI 流式生成中，输入禁用）→ ready
```

- AI 生成中用户**不可提交**新作答（防乱序）
- 进行中会话持久化到 IndexedDB，刷新/断线可恢复，不丢已聊内容
- 空白/中断会话不生成报告、不写入历史

## 6. 面试官 prompt 规则（src/lib/prompts.ts）

- 一次只问一个问题；不评价用户回答（不打断、不判对错）；基于简历内容追问
- 开场：自我介绍题 → 项目深挖（按简历逐段）→ 行为题（STAR）→ 数据/决策题 → 收尾
- 角色是「产品经理岗面试官」，语气专业但不居高临下
- 首题必须问候开场（确认收到简历/或说明无简历），不直接甩题

## 6.5 报告评测规范（src/lib/rubric.ts + report.ts）

- `rubric.ts` 是评分标准的唯一来源：维度固定 4 个 key（logic/depth/data/agility）+ 中文标签；每维有 1/3/5 分行为锚点，相邻档可取 2/4
- 每维必须给 `evidence`（引用对话原句作为打分依据，入库截断 200 字）；无证据支撑的分数视为不合格
- 温度分层：报告生成 temperature=0.2（稳定输出 JSON），对话保持 0.8；改动须同时改 `deepseek.ts` 与调用处
- LLM 输出 schema 不可信：`parseReport` 必须容错（剥 markdown 围栏、截取 JSON、容忍 `summary/overall` 别名、dimensions 数组或对象两种形态、highlight 归一化）；route 解析失败自动重试一次
- prompt 必须含显式 JSON 结构示例并声明「字段名一个都不能改」，防止 schema 漂移

## 7. 异常兜底（用户体验底线）

| 场景                                | 处理                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| 简历解析失败（扫描版 PDF/损坏文件） | 返回友好错误提示，前端引导「转粘贴文本」继续，不白屏                            |
| LLM 超时                            | 自动重试一次，仍失败给「网络开小差，请重试」提示                                |
| /api/report 返回非 JSON             | 解析失败自动重试一次（重试提示只输出纯 JSON），仍失败给「无法解析，请重试」提示 |
| 语音识别失败/无麦克风权限           | 提示后回退纯文字输入，主链路不受影响（麦克风按钮仅在支持时显示）                |
| 面试中途退出                        | 确认弹窗；确认后若问答 < 2 轮则不生成报告                                       |

## 8. 不做的事（P0 范围外，不要顺手实现）

- ❌ 实时/流式语音转写（边说边转）、录音存档与回放、服务端 TTS（朗读目前用浏览器 SpeechSynthesis）
- ❌ 账号系统、数据库、服务端存储用户内容
- ❌ 向量数据库 / RAG（P2 才考虑）
- ❌ 部署、备案、移动端适配（语音依赖桌面 Chrome/Edge）
- ❌ 简历文件本地留存：解析完只保留提取的文本用于会话，文件本身不入库
- ❌ 一次问多题、自动续答、AI 主动收尾

## 9. 页面与路由约定

- `/` 首页：上传简历 + 题量选择 + 跳过出口
- `/interview` 对话页：`?id=<会话ID>` 正式会话；`?resume=<简历文本>&seed=<问题>` 报告页「重答这题」的临时会话（题量固定 10，不保存历史、不生成报告）
- `/report?id=<会话ID>` 报告页（从 IndexedDB 读取；`&generate=1` 触发生成）
- `src/lib/types.ts` 是所有共享类型的唯一来源

## 10. 完成一份工作的检查清单

1. `npm run quality` 全绿（含新写代码的测试）
2. 新功能有对应测试（lib 逻辑单元测试 / 组件交互测试）
3. 人工体验路径可走通（关键页面能用浏览器跑）
4. 未引入 P0 范围外的东西；未破坏密钥红线
5. 架构自查（第 3 章逐条）：依赖单向无循环 / 类型只从 types.ts / 无死代码残留 / 无写了没接线的工具函数 / 大组件已拆
