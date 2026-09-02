<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI 面试陪练（Interview Coach）· AI Agent 约束文件

> 这是本项目对任何 AI 编程 agent 的**硬性约束**。开工前必读；违反以下红线视为交付不合格。

## 1. 产品是什么

上传真实简历（PDF/Word）→ AI 扮演产品经理岗面试官进行多轮文字追问 → 结束后生成面试报告（总评 + 维度评估 + 重点改进 3 处 + 重答这题）。纯文字、无语音。MVP 面向单人本地使用。

## 2. 质量门禁（最重要——任何阶段交付前必须全绿）

**运行 `npm run quality`，四项全过才算完成，否则不算完成：**

```bash
npm run quality   # = lint + format:check + typecheck + vitest run
```

- `lint`：ESLint（禁 `any`、禁遗留 `console.log`，允许 `warn/error`）
- `format:check`：Prettier 统一格式
- `typecheck`：`tsc --noEmit`，TS strict
- `test`：Vitest。**LLM 相关测试必须 mock，不得在测试中发起真实网络请求**
- 覆盖率门槛：`src/lib/**` + `src/components/**` 核心逻辑 ≥ 80%（见 vitest.config.ts）
- 修复格式用 `npm run format`（写文件），不要手动改格式

## 3. 架构与密钥红线（不可违反）

- **API 密钥只在服务端**：`DEEPSEEK_API_KEY` 放在 `.env.local`（已被 .gitignore 忽略），只由 API route（服务端）读取。**任何情况下不得把 key 传给前端组件/浏览器，不得用 `NEXT_PUBLIC_*` 前缀暴露**
- 前端只通过 `fetch("/api/*")` 调用后端；所有 DeepSeek 调用必须经由 `src/lib/deepseek.ts` 的可注入接口（便于测试 mock）
- 无数据库、无账号：用户数据（面试会话、报告）只存浏览器 IndexedDB（`src/lib/store.ts`）
- 报告保留最近 50 条自动清理（store 内实现）

## 4. 对话状态机（对话页核心，防并发错乱）

```
idle → interviewing（AI 流式提问渲染中）→ answered（用户作答等待提交）
     → thinking（AI 生成中，输入禁用）
     ↳ 任意状态可点「结束」→ 确认弹窗 → 调用 /api/report 生成报告
```

- AI 生成中用户**不可提交**新作答（防乱序）
- 进行中会话持久化到 IndexedDB，刷新/断线可恢复，不丢已聊内容
- 空白/中断会话不生成报告、不写入历史

## 5. 面试官 prompt 规则（src/lib/prompts.ts）

- 一次只问一个问题；不评价用户回答（不打断、不判对错）；基于简历内容追问
- 开场：自我介绍题 → 项目深挖（按简历逐段）→ 行为题（STAR）→ 数据/决策题 → 收尾
- 角色是「产品经理岗面试官」，语气专业但不居高临下
- 首题必须问候开场（确认收到简历/或说明无简历），不直接甩题

## 6. 异常兜底（用户体验底线）

| 场景 | 处理 |
| --- | --- |
| 简历解析失败（扫描版 PDF/损坏文件） | 返回友好错误提示，前端引导「转粘贴文本」继续，不白屏 |
| LLM 超时 | 自动重试一次，仍失败给「网络开小差，请重试」提示 |
| /api/report 返回非 JSON | 解析失败自动重试一次，仍失败降级为纯文本展示 |
| 面试中途退出 | 确认弹窗；确认后若问答 < 2 轮则不生成报告 |

## 7. 不做的事（P0 范围外，不要顺手实现）

- ❌ 语音/录音（纯文字产品）
- ❌ 账号系统、数据库、服务端存储用户内容
- ❌ 向量数据库 / RAG（P2 才考虑）
- ❌ 部署、备案、移动端适配
- ❌ 简历文件本地留存：解析完只保留提取的文本用于会话，文件本身不入库
- ❌ 一次问多题、自动续答、AI 主动收尾

## 8. 页面与路由约定

- `/` 首页：上传简历 + 题量选择 + 跳过出口
- `/interview` 对话页（可带 `?resume=` 简历文本 / `?count=` 题量）
- `/report?id=<会话ID>` 报告页（从 IndexedDB 读取）
- `src/lib/types.ts` 是所有共享类型的唯一来源

## 9. 完成一份工作的检查清单

1. `npm run quality` 全绿（含新写代码的测试）
2. 新功能有对应测试（lib 逻辑单元测试 / 组件交互测试）
3. 人工体验路径可走通（关键页面能用浏览器跑）
4. 未引入 P0 范围外的东西；未破坏密钥红线
